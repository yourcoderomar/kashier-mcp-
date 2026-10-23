import { z } from "zod";
import { KashierError } from "../kashier/types.js";
import type { ToolDef } from "./index.js";
import { egp } from "./fetch-range.js";

export const createPaymentLink: ToolDef = {
  name: "create_payment_link",
  description:
    "Create a Kashier hosted payment link (payment session) that a customer can open to pay by card or wallet. " +
    "Use when the merchant wants to charge a customer or send them a pay link. Amounts are in EGP. " +
    "Returns the payment URL to share, the session ID (use with get_payment_status) and the expiry. " +
    "The order reference must be unique per order.",
  inputSchema: {
    amount: z.number().positive().describe("Amount to charge in EGP, positive, max 2 decimals (e.g. 250 or 99.50)"),
    orderReference: z.string().min(1).describe("Your unique order reference, e.g. ORD-10231"),
    customerEmail: z.string().email().describe("Customer email address (required by Kashier)"),
    customerPhone: z.string().optional().describe("Customer phone number, stored as metadata (optional)"),
    customerReference: z.string().optional().describe("Your customer ID; defaults to the customer email"),
    description: z.string().max(119).optional().describe("Short description shown on the payment page, under 120 chars"),
    expiresInHours: z.number().min(1).max(720).optional().describe("Hours until the link expires, 1-720 (default 24)"),
  },
  async run(client, a) {
    if (!(a.amount > 0) || Math.round(a.amount * 100) / 100 !== a.amount)
      throw new KashierError("amount must be a positive number with at most 2 decimals");
    const hours = a.expiresInHours ?? 24;
    const expireAt = new Date(Date.now() + hours * 3600_000).toISOString();
    const s = await client.createSession({
      amount: a.amount.toFixed(2),
      order: a.orderReference,
      expireAt,
      customer: { email: a.customerEmail, reference: a.customerReference ?? a.customerEmail },
      ...(a.customerPhone ? { metaData: { customerPhone: a.customerPhone } } : {}),
      ...(a.description ? { description: a.description } : {}),
    });
    return [
      `Payment link created: ${s.sessionUrl}`,
      `Session ID: ${s._id}`,
      `Order reference: ${a.orderReference}`,
      `Amount: ${egp(a.amount)}`,
      `Expires: ${s.expireAt ?? expireAt}`,
    ].join("\n");
  },
};
