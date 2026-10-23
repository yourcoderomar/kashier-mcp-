import {
  KashierError,
  type CreateSessionInput,
  type KashierClient,
  type ListTransactionsQuery,
  type Pagination,
  type PaymentSession,
  type PaymentSessionDetails,
  type ReconciledOrder,
  type RefundResult,
  type TransactionDetails,
  type TransactionRecord,
} from "./types.js";

const BRANDS = ["Mastercard", "Visa", "Meeza"];
const BINS = ["512345", "411111", "507803"];
const HOUR = 3600_000;

/** Deterministic in-memory Kashier: 40 transactions over the 30 days before `now`. */
export class MockKashierClient implements KashierClient {
  readonly now: Date;
  readonly transactions: TransactionRecord[] = [];
  readonly orders: ReconciledOrder[] = [];
  readonly sessions = new Map<string, PaymentSessionDetails & { expireAt: string }>();
  readonly refunds: { orderId: string; amount: number; reason?: string; transactionId: string }[] = [];
  private seq = 1;

  constructor(opts: { now?: Date } = {}) {
    this.now = opts.now ?? new Date();
    for (let i = 0; i < 40; i++) {
      const date = new Date(this.now.getTime() - (i * 18 + 1) * HOUR).toISOString();
      const amount = Math.round(((i * 7919) % 485000) + 14900) / 100; // 149.00 - 4,999.00
      const status = i % 5 === 4 ? "Rejected" : "Approved";
      const wallet = i % 9 === 0;
      const b = i % 3;
      const merchantOrderId = `ORD-${10200 + i}`;
      const transactionId = `TX-${900100 + i}`;
      const rec: TransactionRecord = {
        transactionId,
        merchantOrderId,
        orderReference: merchantOrderId,
        id: `KO-${700100 + i}`,
        status,
        type: i === 7 || i === 23 ? "REFUND" : "PAYMENT",
        method: wallet ? "wallet" : "card",
        currency: "EGP",
        amount,
        totalCapturedAmount: status === "Approved" ? amount : 0,
        date,
        ...(wallet ? {} : { sourceOfFunds: { cardInfo: { cardBrand: BRANDS[b], maskedCard: `${BINS[b]}******${String(1000 + i * 37).slice(-4)}` } } }),
      };
      this.transactions.push(rec);
      this.orders.push({
        merchantOrderId,
        orderId: rec.id!,
        status: status === "Approved" ? "CAPTURED" : "FAILED",
        transactions: [{ operation: "pay", status: status === "Approved" ? "SUCCESS" : "FAILURE", transactionId, amount, date }],
      });
    }
    this.sessions.set("SES-PAID-1", {
      sessionId: "SES-PAID-1",
      status: "PAID",
      createdAt: this.transactions[0].date,
      updatedAt: this.transactions[0].date,
      merchantOrderId: "ORD-10200",
      amount: Number(this.transactions[0].amount).toFixed(2),
      currency: "EGP",
      method: "wallet",
      orderId: "KO-700100",
      expireAt: new Date(this.now.getTime() + 24 * HOUR).toISOString(),
    });
  }

  async createSession(input: CreateSessionInput): Promise<PaymentSession> {
    const id = `SES-${String(this.seq++).padStart(4, "0")}`;
    const ts = this.now.toISOString();
    this.sessions.set(id, {
      sessionId: id,
      status: "CREATED",
      createdAt: ts,
      updatedAt: ts,
      merchantOrderId: input.order,
      amount: input.amount,
      currency: "EGP",
      orderId: "NA",
      expireAt: input.expireAt,
    });
    return {
      _id: id,
      status: "CREATED",
      expireAt: input.expireAt,
      sessionUrl: `https://payments.kashier.io/session/${id}?mode=test`,
      paymentParams: { amount: input.amount, currency: "EGP", order: input.order },
    };
  }

  async getSessionDetails(sessionId: string): Promise<PaymentSessionDetails> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new KashierError(`Not found: session ${sessionId}`, 404);
    return s;
  }

  async searchOrders(search: string): Promise<ReconciledOrder[]> {
    const q = search.toLowerCase();
    return this.orders.filter((o) => o.merchantOrderId.toLowerCase().includes(q));
  }

  async listTransactions(q: ListTransactionsQuery): Promise<{ items: TransactionRecord[]; pagination: Pagination }> {
    let rows = this.transactions.filter(
      (t) => (!q.status || t.status.toLowerCase() === q.status) && (!q.type || t.type?.toLowerCase() === q.type) &&
        (!q.search || [t.transactionId, t.merchantOrderId].some((v) => v?.toLowerCase().includes(q.search!.toLowerCase()))),
    );
    const dir = q.sortType === 1 ? 1 : -1;
    rows = [...rows].sort((a, b) => dir * (Date.parse(a.date) - Date.parse(b.date)));
    const limit = q.limit ?? 20;
    const page = q.page ?? 1;
    return {
      items: rows.slice((page - 1) * limit, page * limit),
      pagination: { total: rows.length, page, limit, pages: Math.ceil(rows.length / limit) },
    };
  }

  async getTransaction(transactionId: string): Promise<TransactionDetails> {
    const t = this.transactions.find((x) => x.transactionId === transactionId);
    if (!t) throw new KashierError(`Not found: transaction ${transactionId}`, 404);
    const card = t.sourceOfFunds?.cardInfo;
    return {
      transactionId,
      merchantOrderId: t.merchantOrderId,
      status: t.status,
      currency: t.currency,
      // no amount: the documented details response doesn't carry one
      date: t.date,
      trxType: t.type,
      order: { orderId: t.id, orderReference: t.merchantOrderId },
      ...(card ? { sourceOfFunds: { maskedCard: card.maskedCard, cardBrand: card.cardBrand } } : {}),
    };
  }

  async refundOrder(orderId: string, amount: number, reason?: string): Promise<RefundResult> {
    const transactionId = `TX-RF-${String(this.refunds.length + 1).padStart(4, "0")}`;
    this.refunds.push({ orderId, amount, reason, transactionId });
    return { status: "SUCCESS", response: { status: "SUCCESS", transactionId, amount, currency: "EGP" } };
  }
}
