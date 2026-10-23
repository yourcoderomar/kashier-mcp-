import { z } from "zod";
import type { ToolDef } from "./index.js";
import { egp, fetchTransactionsInRange, txAmount } from "./fetch-range.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

export const salesSummary: ToolDef = {
  name: "sales_summary",
  description:
    "Summarize sales for a date range: total paid amount (EGP), number of paid payments, average order value and number of failed payments. " +
    "Both dates are required, ISO YYYY-MM-DD, inclusive (UTC). Refunds are excluded.",
  inputSchema: {
    from: day.describe("Start date YYYY-MM-DD, inclusive"),
    to: day.describe("End date YYYY-MM-DD, inclusive"),
  },
  async run(client, a) {
    const { items, truncated } = await fetchTransactionsInRange(client, { from: a.from, to: a.to, type: "payment", max: Infinity });
    const paid = items.filter((t) => t.status === "Approved");
    const total = paid.reduce((s, t) => s + txAmount(t), 0);
    const failed = items.filter((t) => t.status === "Rejected").length;
    return [
      `Sales summary ${a.from} to ${a.to}`,
      `Total paid: ${egp(total)}`,
      `Paid payments: ${paid.length}`,
      `Average order value: ${paid.length ? egp(total / paid.length) : "n/a"}`,
      `Failed payments: ${failed}`,
      ...(truncated ? ["Note: stopped after 10 pages (1000 transactions); figures are incomplete. Use a shorter range."] : []),
    ].join("\n");
  },
};
