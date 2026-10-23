import { baseUrl } from "../config.js";
import {
  KashierError,
  type Config,
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

/** Best human-readable message from Kashier's several error body shapes. */
function extractMessage(body: any, raw: string): string {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  if (body && typeof body === "object") {
    const more = Array.isArray(body.more_info)
      ? body.more_info.map((m: any) => str(m?.message)).filter(Boolean).join("; ")
      : "";
    return (
      str(body.messages?.en) ??
      str(body.message) ??
      str(body.error) ??
      str(body.error?.cause) ??
      (more || undefined) ??
      "no details provided"
    );
  }
  return raw.trim().slice(0, 200) || "no details provided";
}

function mapError(status: number, msg: string): KashierError {
  let text: string;
  // Seen on the test API: a 401 wrapping an upstream socket error ("read ECONNRESET") — transient, not a bad key.
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(msg))
    text = `Kashier had a temporary internal connection error (${status}: ${msg}). Retry in a moment.`;
  else if (status === 401)
    text = `Kashier rejected the credentials (401): ${msg}. Check KASHIER_SECRET_KEY, that the key matches KASHIER_MODE (test keys only work on test hosts), and that the key's role has permission for this action.`;
  else if (status === 403)
    text = /\bIP\b/i.test(msg)
      ? `Kashier refused the request (403): ${msg}. Your IP is not on the Kashier IP allow-list.`
      : `Kashier refused the request (403): ${msg}. Is the Authorization header/secret key set?`;
  else if (status === 404) text = `Not found: ${msg}`;
  else if (status === 400) text = `Kashier rejected the request: ${msg}`;
  else if (status >= 500) text = `Kashier server error (${status}). Try again later.`;
  else text = `Kashier returned HTTP ${status}: ${msg}`;
  return new KashierError(text, status);
}

export class HttpKashierClient implements KashierClient {
  private base: string;
  constructor(private config: Config) {
    this.base = baseUrl(config.mode);
  }

  private async request(method: string, path: string, opts: { body?: unknown; apiKey?: boolean } = {}): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: this.config.secretKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (opts.apiKey) headers["api-key"] = this.config.apiKey;

    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new KashierError(`Could not reach Kashier at ${new URL(this.base).host}: ${(e as Error).message}`);
    }

    const raw = await res.text();
    let json: any;
    try {
      json = raw ? JSON.parse(raw) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) throw mapError(res.status, extractMessage(json, raw));
    if (json === undefined) throw new KashierError(`Kashier returned a non-JSON response (HTTP ${res.status}).`, res.status);
    return json;
  }

  createSession(input: CreateSessionInput): Promise<PaymentSession> {
    return this.request("POST", "/v3/payment/sessions", {
      apiKey: true,
      body: {
        expireAt: input.expireAt,
        maxFailureAttempts: 3,
        paymentType: "credit",
        amount: input.amount,
        currency: "EGP",
        order: input.order,
        merchantId: this.config.merchantId,
        merchantRedirect: this.config.merchantRedirect,
        display: "en",
        type: "one-time",
        customer: input.customer,
        metaData: input.metaData,
        description: input.description,
      },
    });
  }

  async getSessionDetails(sessionId: string): Promise<PaymentSessionDetails> {
    return (await this.request("GET", `/v3/payment/sessions/${encodeURIComponent(sessionId)}/payment`)).data;
  }

  async searchOrders(search: string): Promise<ReconciledOrder[]> {
    return (await this.request("GET", `/v3/payment/orders?search=${encodeURIComponent(search)}`)).data;
  }

  async listTransactions(q: ListTransactionsQuery): Promise<{ items: TransactionRecord[]; pagination: Pagination }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) qs.set(k, String(v)); // unknown/undefined keys cause 400
    // Docs list lowercase, but the test API rejects it: wants PAYMENT/REFUND and Approved/Rejected/Unknown.
    if (q.type) qs.set("type", q.type.toUpperCase());
    if (q.status) qs.set("status", q.status[0].toUpperCase() + q.status.slice(1));
    const s = qs.toString();
    const body = await this.request("GET", `/v2/aggregator/transactions${s ? "?" + s : ""}`);
    return { items: body.body ?? [], pagination: body.pagination ?? {} };
  }

  async getTransaction(transactionId: string): Promise<TransactionDetails> {
    return (await this.request("GET", `/v2/aggregator/transactions/${encodeURIComponent(transactionId)}`)).body;
  }

  refundOrder(orderId: string, amount: number, reason?: string): Promise<RefundResult> {
    return this.request("PUT", `/v3/payment/refund/${encodeURIComponent(orderId)}`, {
      body: { apiOperation: "REFUND", reason, transaction: { amount } },
    });
  }
}
