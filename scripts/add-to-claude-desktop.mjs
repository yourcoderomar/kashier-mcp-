// Adds this server to Claude Desktop's config using the values in .env.
// Run it with Claude Desktop fully QUIT — the running app re-saves its config and drops manual edits.
//   node --env-file=.env scripts/add-to-claude-desktop.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { APPDATA = "", LOCALAPPDATA = "", HOME = "" } = process.env;
const candidates = [
  // Microsoft Store build with relocated user data
  ...(fs.existsSync(path.join(LOCALAPPDATA, "Claude-Data"))
    ? fs.readdirSync(path.join(LOCALAPPDATA, "Claude-Data")).map((d) => path.join(LOCALAPPDATA, "Claude-Data", d))
    : []),
  path.join(APPDATA, "Claude"),
  path.join(HOME, "Library", "Application Support", "Claude"),
].map((d) => path.join(d, "claude_desktop_config.json"));

const file = candidates.find((f) => fs.existsSync(f)) ?? candidates.find((f) => fs.existsSync(path.dirname(f)));
if (!file) throw new Error("Claude Desktop config folder not found.");

const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const env = Object.fromEntries(
  ["KASHIER_MODE", "KASHIER_SECRET_KEY", "KASHIER_API_KEY", "KASHIER_MERCHANT_ID", "KASHIER_MERCHANT_REDIRECT", "KASHIER_ALLOW_LIVE"]
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
cfg.mcpServers = { ...cfg.mcpServers, kashier: { command: process.execPath, args: [script], env } };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
console.log(`Added "kashier" (mode: ${env.KASHIER_MODE ?? "test"}) to ${file}`);
console.log("Env vars set:", Object.keys(env).join(", ")); // names only, never values
