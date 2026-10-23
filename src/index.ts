#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HttpKashierClient } from "./kashier/client.js";
import { MockKashierClient } from "./kashier/mock.js";
import { KashierError, type Config } from "./kashier/types.js";
import { tools } from "./tools/index.js";

let config: Config;
try {
  config = loadConfig();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const client = config.mode === "mock" ? new MockKashierClient() : new HttpKashierClient(config);
const server = new McpServer({ name: "kashier-mcp", version: "0.1.0" });

for (const t of tools) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, async (args: any) => {
    try {
      return { content: [{ type: "text" as const, text: await t.run(client, args, config) }] };
    } catch (e) {
      const text = e instanceof KashierError ? e.message : "Unexpected error: " + (e as Error).message;
      return { content: [{ type: "text" as const, text }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
console.error(`kashier-mcp running in ${config.mode} mode`);
