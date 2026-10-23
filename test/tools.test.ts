import { describe, expect, it } from "vitest";
import { MockKashierClient } from "../src/kashier/mock.js";
import { KashierError, type Config, type KashierClient } from "../src/kashier/types.js";
import { tools } from "../src/tools/index.js";
import { MAX_PAGES, fetchTransactionsInRange } from "../src/tools/fetch-range.js";

const NOW = new Date("2026-06-30T12:00:00.000Z");
const config: Config = { mode: "mock", secretKey: "", apiKey: "", merchantId: "MID-1", merchantRedirect: "" };
const fresh = () => new MockKashierClient({ now: NOW });
const run = (c: KashierClient, name: string, args: object) => tools.find((t) => t.name === name)!.run(c, args, config);
const day = (iso: string) => iso.slice(0, 10);

describe("create_payment_link", () => {
  it("returns URL and sends amount as fixed-2 string", async () => {
    const c = fresh();
    let seen: any;
    const orig = c.createSession.bind(c);
    c.createSession = async (i) => ((seen = i), orig(i));
    const out = await run(c, "create_payment_link", { amount: 250, orderReference: "ORD-1", customerEmail: "a@b.com", customerPhone: "0100" });
    expect(out).toContain("https://payments.kashier.io/session/");
    expect(out).toContain("250.00 EGP");
    expect(seen.amount).toBe("250.00");
    expect(seen.customer).toEqual({ email: "a@b.com", reference: "a@b.com" });
    expect(seen.metaData).toEqual({ customerPhone: "0100" });
  });
  it("rejects more than 2 decimals", async () => {
    await expect(run(fresh(), "create_payment_link", { amount: 1.234, orderReference: "O", customerEmail: "a@b.com" })).rejects.toThrow(KashierError);
  });
});

describe("get_payment_status", () => {
  it("by session id: new session is pending, seeded one is paid", async () => {
    const c = fresh();
    const m = (await run(c, "create_payment_link", { amount: 100, orderReference: "ORD-X", customerEmail: "a@b.com" })).match(/Session ID: (\S+)/)!;
    expect(await run(c, "get_payment_status", { sessionId: m[1] })).toContain("Status: pending (Kashier session status: CREATED)");
    expect(await run(c, "get_payment_status", { sessionId: "SES-PAID-1" })).toContain("Status: paid");
  });
  it("by order reference: exact match among partial matches", async () => {
    const c = fresh();
    const out = await run(c, "get_payment_status", { orderReference: "ORD-10201" });
    expect(out).toContain("Status: paid");
    expect(out).toContain("Order reference: ORD-10201");
    // ORD-10204 is Rejected -> failed
    expect(await run(c, "get_payment_status", { orderReference: "ORD-10204" })).toContain("Status: failed");
    // partial "ORD-1020" matches many orders but none exactly
    await expect(run(c, "get_payment_status", { orderReference: "ORD-1020" })).rejects.toThrow("No order found with reference ORD-1020");
  });
  it("requires exactly one identifier", async () => {
    const c = fresh();
    await expect(run(c, "get_payment_status", {})).rejects.toThrow(KashierError);
    await expect(run(c, "get_payment_status", { sessionId: "a", orderReference: "b" })).rejects.toThrow(KashierError);
  });
});

describe("list_transactions", () => {
  it("respects date range, status and limit", async () => {
    const c = fresh();
    const from = "2026-06-20", to = "2026-06-25";
    const expected = c.transactions.filter((t) => day(t.date) >= from && day(t.date) <= to);
    expect(expected.length).toBeGreaterThan(3);
    const out = await run(c, "list_transactions", { from, to, limit: 100 });
    expect(out).toContain(`${expected.length} transaction(s)`);
    for (const t of expected) expect(out).toContain(t.transactionId);
    expect(out).not.toContain(c.transactions[0].transactionId); // newer than `to`

    const rej = await run(c, "list_transactions", { status: "rejected", limit: 100 });
    expect(rej).not.toContain("| Approved |");
    expect(rej).toContain("| Rejected |");

    const lim = await run(c, "list_transactions", { limit: 3 });
    expect(lim).toContain("3 transaction(s)");
  });
  it("filters refunds", async () => {
    const out = await run(fresh(), "list_transactions", { type: "refund" });
    expect(out).toContain("2 transaction(s)");
  });
});

describe("sales_summary", () => {
  it("matches independently computed totals", async () => {
    const c = fresh();
    const from = "2026-06-01", to = "2026-06-30";
    const inRange = c.transactions.filter((t) => t.type === "PAYMENT" && day(t.date) >= from && day(t.date) <= to);
    const paid = inRange.filter((t) => t.status === "Approved");
    const total = paid.reduce((s, t) => s + Number(t.amount), 0);
    const out = await run(c, "sales_summary", { from, to });
    const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(out).toContain(`Total paid: ${fmt(total)} EGP`);
    expect(out).toContain(`Paid payments: ${paid.length}`);
    expect(out).toContain(`Average order value: ${fmt(total / paid.length)} EGP`);
    expect(out).toContain(`Failed payments: ${inRange.filter((t) => t.status === "Rejected").length}`);
  });
  it("average is n/a with no sales", async () => {
    expect(await run(fresh(), "sales_summary", { from: "2020-01-01", to: "2020-01-31" })).toContain("Average order value: n/a");
  });
});

describe("refund_payment", () => {
  const tx = (c: MockKashierClient) => c.transactions.find((t) => t.status === "Approved" && t.type === "PAYMENT" && t.sourceOfFunds)!;

  it("previews without confirm or with confirm false", async () => {
    const c = fresh();
    const t = tx(c);
    for (const args of [{ transactionId: t.transactionId }, { transactionId: t.transactionId, confirm: false }]) {
      const out = await run(c, "refund_payment", args);
      expect(out).toContain("PREVIEW — nothing refunded yet");
      expect(out).toContain("(full)");
      expect(out).toContain(t.sourceOfFunds!.cardInfo!.cardBrand!);
    }
    expect(c.refunds).toHaveLength(0);
  });
  it("partial refund with confirm true", async () => {
    const c = fresh();
    const t = tx(c);
    const out = await run(c, "refund_payment", { transactionId: t.transactionId, amount: 50, reason: "damaged", confirm: true });
    expect(c.refunds).toEqual([{ orderId: t.id, amount: 50, reason: "damaged", transactionId: "TX-RF-0001" }]);
    expect(out).toContain("SUCCESS");
    expect(out).toContain("50.00 EGP");
  });
  it("reads the real test-API shape: response.status is the order state, not the outcome", async () => {
    const c = fresh();
    const t = tx(c);
    c.refundOrder = async () => ({ response: { status: "PARTIALLY_REFUNDED", transactionId: "TX-R", amount: 10 } });
    const out = await run(c, "refund_payment", { transactionId: t.transactionId, amount: 10, confirm: true });
    expect(out).toContain("Refund SUCCESS: refund processed");
    expect(out).toContain("(now PARTIALLY_REFUNDED)");
  });
  it("full refund when amount omitted", async () => {
    const c = fresh();
    const t = tx(c);
    await run(c, "refund_payment", { transactionId: t.transactionId, confirm: true });
    expect(c.refunds[0].amount).toBe(Number(t.amount));
  });
  it("errors on amount > original and unknown transaction", async () => {
    const c = fresh();
    const t = tx(c);
    await expect(run(c, "refund_payment", { transactionId: t.transactionId, amount: Number(t.amount) + 1, confirm: true })).rejects.toThrow(KashierError);
    await expect(run(c, "refund_payment", { transactionId: "nope", confirm: true })).rejects.toThrow("Not found: transaction nope");
    expect(c.refunds).toHaveLength(0);
  });
});

describe("fetchTransactionsInRange", () => {
  it("stops after MAX_PAGES and flags truncation", async () => {
    let calls = 0;
    const rec = { transactionId: "T", status: "Approved", date: "2026-06-15T00:00:00.000Z" };
    const fake = {
      listTransactions: async () => (calls++, { items: Array(100).fill(rec), pagination: { pages: 999 } }),
    } as unknown as KashierClient;
    const r = await fetchTransactionsInRange(fake, { from: "2026-06-01", max: Infinity });
    expect(calls).toBe(MAX_PAGES);
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(MAX_PAGES * 100);
  });
});
