import { z } from "zod";
import type { Config, Mode } from "./kashier/types.js";

const modeSchema = z.enum(["test", "live", "mock"]);

export function baseUrl(mode: Mode): string {
  return mode === "live" ? "https://api.kashier.io" : "https://test-api.kashier.io";
}

const required = (name: string) => z.string({ error: `${name} is required` }).min(1, `${name} is required`);

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode = modeSchema.safeParse(env.KASHIER_MODE?.trim() || "test");
  if (!mode.success) throw new Error('KASHIER_MODE must be one of "test", "live", "mock"');

  if (mode.data === "mock") {
    return {
      mode: "mock",
      secretKey: "",
      apiKey: "",
      merchantId: env.KASHIER_MERCHANT_ID || "MID-0000-0000",
      merchantRedirect: env.KASHIER_MERCHANT_REDIRECT || "https://example.com/thanks",
    };
  }

  if (mode.data === "live" && env.KASHIER_ALLOW_LIVE !== "true") {
    throw new Error("KASHIER_MODE=live moves real money. Set KASHIER_ALLOW_LIVE=true to confirm.");
  }

  // Messages name the variable only, never the value.
  const schema = z.object({
    KASHIER_SECRET_KEY: required("KASHIER_SECRET_KEY"),
    KASHIER_API_KEY: required("KASHIER_API_KEY"),
    KASHIER_MERCHANT_ID: required("KASHIER_MERCHANT_ID").regex(
      /^MID-\d+-\d+$/,
      "KASHIER_MERCHANT_ID must match MID-<digits>-<digits>",
    ),
    KASHIER_MERCHANT_REDIRECT: required("KASHIER_MERCHANT_REDIRECT").url(
      "KASHIER_MERCHANT_REDIRECT must be a valid URL",
    ),
  });
  const r = schema.safeParse(env);
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join("; "));
  return {
    mode: mode.data,
    secretKey: r.data.KASHIER_SECRET_KEY,
    apiKey: r.data.KASHIER_API_KEY,
    merchantId: r.data.KASHIER_MERCHANT_ID,
    merchantRedirect: r.data.KASHIER_MERCHANT_REDIRECT,
  };
}
