import type { KashierClient, TransactionRecord } from "../kashier/types.js";

export const MAX_PAGES = 10;
const PAGE_SIZE = 100;

export const egp = (n: number) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`;

export const txAmount = (t: TransactionRecord) =>
  Number(t.amount ?? t.totalCapturedAmount ?? t.totalAuthorizedAmount) || 0;

export interface RangeQuery {
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  status?: "approved" | "rejected" | "unknown";
  type?: "payment" | "refund";
  max: number;
}

/** Kashier's list endpoint has no date filter: page newest-first and stop once older than `from`. */
export async function fetchTransactionsInRange(
  client: KashierClient,
  { from, to, status, type, max }: RangeQuery,
): Promise<{ items: TransactionRecord[]; truncated: boolean }> {
  const fromMs = from ? Date.parse(`${from}T00:00:00.000Z`) : -Infinity;
  const toMs = to ? Date.parse(`${to}T23:59:59.999Z`) : Infinity;
  const items: TransactionRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.listTransactions({ page, limit: PAGE_SIZE, status, type, sortBy: "date", sortType: -1 });
    for (const rec of res.items) {
      const t = Date.parse(rec.date);
      if (t < fromMs) return { items, truncated: false };
      if (t > toMs) continue;
      items.push(rec);
      if (items.length >= max) return { items, truncated: false };
    }
    if (res.items.length < PAGE_SIZE || page >= (res.pagination.pages ?? page)) return { items, truncated: false };
  }
  return { items, truncated: true };
}
