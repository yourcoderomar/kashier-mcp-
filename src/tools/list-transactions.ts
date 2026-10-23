import { z } from "zod";
import type { ToolDef } from "./index.js";
import { egp, fetchTransactionsInRange, txAmount } from "./fetch-range.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

export const listTransactionsTool: ToolDef = {
  name: "list_transactions",
  description:
    "List recent Kashier transactions, newest first, optionally limited to a date range (inclusive, ISO YYYY-MM-DD), status and type. " +
    "Use to see recent payments, failures or refunds. Amounts are in EGP. For totals use sales_summary instead.",
  inputSchema: {
    from: day.optional().describe("Start date YYYY-MM-DD, inclusive (UTC)"),
    to: day.optional().describe("End date YYYY-MM-DD, inclusive (UTC)"),
    status: z.enum(["approved", "rejected", "unknown"]).optional().describe("Filter by transaction status"),
    type: z.enum(["payment", "refund"]).optional().describe("Filter by transaction type"),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return, 1-100 (default 20)"),
  },
  async run(client, a) {
    const limit = a.limit ?? 20;
    const { items, truncated } = await fetchTransactionsInRange(client, { ...a, max: limit });
    const note = truncated ? "\nNote: stopped after 10 pages (1000 transactions); narrow the date range for complete results." : "";
    if (!items.length) return `No transactions found for the given filters.${note}`;
    const lines = items.map((t) => {
      const card = t.sourceOfFunds?.cardInfo;
      const how = card ? `${card.cardBrand ?? "card"} ${card.maskedCard ?? ""}`.trim() : (t.method ?? "n/a");
      return [t.date, t.transactionId, t.merchantOrderId ?? "-", t.type ?? "-", t.status, egp(txAmount(t)), how].join(" | ");
    });
    return `${items.length} transaction(s) (date | transaction | order | type | status | amount | method):\n${lines.join("\n")}${note}`;
  },
};
