import { z } from "zod";
import { KashierError } from "../kashier/types.js";
import type { ToolDef } from "./index.js";
import { egp } from "./fetch-range.js";

const SESSION_FAILED = ["FAILED", "EXPIRED", "ABANDONED", "REJECTED"];
const SESSION_REVERSED = ["REFUNDED", "VOIDED", "REVERSED"];
const SESSION_PART_REFUNDED = ["PARTIALLY_REFUNDED", "REFUND_PENDING"];
const ORDER_FAILED = ["FAILED", "EXPIRED", "REJECTED", "CANCELLED", "REVERSED"];

const fromSession = (s: string) =>
  s === "PAID"
    ? "paid"
    : SESSION_FAILED.includes(s)
      ? "failed"
      : SESSION_REVERSED.includes(s)
        ? "refunded/voided (was paid, then reversed)"
        : SESSION_PART_REFUNDED.includes(s)
          ? "paid (partially refunded or refund pending)"
          : "pending";
const fromOrder = (s: string) => (s === "CAPTURED" ? "paid" : ORDER_FAILED.includes(s) ? "failed" : "pending");

export const getPaymentStatus: ToolDef = {
  name: "get_payment_status",
  description:
    "Check whether a payment was completed. Provide EXACTLY ONE of sessionId (from create_payment_link) or orderReference (your merchant order ref). " +
    "Returns a normalized status (paid / pending / failed / refunded) plus Kashier's raw status, amount and timestamp.",
  inputSchema: {
    sessionId: z.string().optional().describe("Kashier payment session ID returned by create_payment_link"),
    orderReference: z.string().optional().describe("Merchant order reference, e.g. ORD-10231 (exact match)"),
  },
  async run(client, a) {
    if (!!a.sessionId === !!a.orderReference) throw new KashierError("Provide exactly one of sessionId or orderReference.");
    if (a.sessionId) {
      const s = await client.getSessionDetails(a.sessionId);
      return [
        `Status: ${fromSession(s.status)} (Kashier session status: ${s.status})`,
        `Amount: ${egp(Number(s.amount))}${s.currency && s.currency !== "EGP" ? ` (${s.currency})` : ""}`,
        `Order reference: ${s.merchantOrderId}`,
        `Session ID: ${s.sessionId}`,
        ...(s.orderId && s.orderId !== "NA" ? [`Kashier order ID: ${s.orderId}`] : []),
        `Updated: ${s.updatedAt}`,
      ].join("\n");
    }
    const found = (await client.searchOrders(a.orderReference)).find((o) => o.merchantOrderId === a.orderReference);
    if (!found) throw new KashierError(`No order found with reference ${a.orderReference}`);
    const txs = found.transactions ?? [];
    const withAmount = [...txs].reverse().find((t) => t.amount != null);
    const last = txs[txs.length - 1];
    // Real orders carry totalCapturedAmount/updatedAt (not in the docs example); fall back to the transactions.
    const amount = found.totalCapturedAmount ?? withAmount?.amount;
    const updated = found.updatedAt ?? last?.responseDate ?? last?.date;
    return [
      `Status: ${fromOrder(found.status)} (Kashier order status: ${found.status})`,
      `Amount: ${amount != null ? egp(Number(amount)) : "n/a"}`,
      // OrderStatus has no refunded state; real orders report refunds in totalRefundedAmount.
      ...(Number(found.totalRefundedAmount) > 0 ? [`Refunded: ${egp(Number(found.totalRefundedAmount))}`] : []),
      `Order reference: ${found.merchantOrderId}`,
      `Kashier order ID: ${found.orderId}`,
      `Updated: ${updated ?? "n/a"}`,
    ].join("\n");
  },
};
