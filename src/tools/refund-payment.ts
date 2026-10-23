import { z } from "zod";
import { KashierError } from "../kashier/types.js";
import type { ToolDef } from "./index.js";
import { egp, txAmount } from "./fetch-range.js";

export const refundPayment: ToolDef = {
  name: "refund_payment",
  description:
    "Refund a Kashier payment, fully or partially, by transaction ID (from list_transactions). Amounts are in EGP. " +
    "ALWAYS call this first WITHOUT confirm: it returns a PREVIEW and refunds nothing; show that preview to the user and ask for approval. " +
    "Only after the user explicitly agrees, call again with confirm: true. In live mode refunds move real money and cannot be undone.",
  inputSchema: {
    transactionId: z.string().min(1).describe("Transaction ID of the original payment"),
    amount: z.number().positive().optional().describe("EGP amount to refund; omit for a full refund"),
    reason: z.string().optional().describe("Reason for the refund (optional)"),
    confirm: z.boolean().optional().describe("Must be true to actually perform the refund; omit or false for a preview"),
  },
  async run(client, a) {
    const tx = await client.getTransaction(a.transactionId);
    const orderId = tx.order?.orderId;
    if (!orderId) throw new KashierError(`Transaction ${a.transactionId} has no Kashier order and cannot be refunded.`);
    // The documented details response has no amount field; the list record (searchable by trxId) does.
    let original = Number(tx.amount);
    if (!Number.isFinite(original)) {
      const rec = (await client.listTransactions({ search: a.transactionId, limit: 1 })).items[0];
      if (rec) original = txAmount(rec);
    }
    if (!(original > 0)) throw new KashierError(`Cannot determine the original amount of transaction ${a.transactionId}.`);
    const amount: number = a.amount ?? original;
    if (amount > original) throw new KashierError(`Refund amount ${egp(amount)} exceeds the original payment of ${egp(original)}.`);
    const ref = tx.merchantOrderId ?? tx.order?.orderReference ?? orderId; // merchant's own ref first
    if (a.confirm !== true) {
      const card = tx.sourceOfFunds?.maskedCard
        ? `${tx.sourceOfFunds.cardBrand ?? "card"} ****${tx.sourceOfFunds.maskedCard.slice(-4)}`
        : "the original payment method";
      return `PREVIEW — nothing refunded yet. This will refund ${egp(amount)} (${amount === original ? "full" : "partial"}) of ${egp(original)} to ${card} for order ${ref} (transaction ${a.transactionId}). Call again with confirm: true to proceed.`;
    }
    const r = await client.refundOrder(orderId, amount, a.reason);
    // Top-level status is the request outcome. On the test API response.status held the resulting
    // order state (e.g. PARTIALLY_REFUNDED) rather than SUCCESS/PENDING/FAILURE, so accept either.
    const OUTCOMES = ["SUCCESS", "PENDING", "FAILURE"];
    const rs = r.response?.status;
    const st = rs && OUTCOMES.includes(rs) ? rs : (r.status ?? (rs?.includes("REFUNDED") ? "SUCCESS" : "UNKNOWN"));
    const orderState = rs && !OUTCOMES.includes(rs) ? rs : undefined;
    const meaning =
      st === "SUCCESS"
        ? "refund processed"
        : st === "PENDING"
          ? "refund is pending and will complete shortly"
          : st === "FAILURE"
            ? "refund NOT processed; the balance is credited back"
            : "unknown result, verify in the Kashier dashboard";
    return [
      `Refund ${st}: ${meaning}.`,
      `Amount: ${egp(r.response?.amount ?? amount)}`,
      `Order: ${ref}${orderState ? ` (now ${orderState})` : ""}`,
      ...(r.response?.transactionId ? [`Refund transaction ID: ${r.response.transactionId}`] : []),
    ].join("\n");
  },
};
