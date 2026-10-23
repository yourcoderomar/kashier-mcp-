// Shared contract between the HTTP client, the mock client and the tools.
// Shapes follow https://developers.kashier.io/openapi.yaml — only the fields we read.

export type Mode = "test" | "live" | "mock";

export interface Config {
  mode: Mode;
  secretKey: string; // "" in mock mode
  apiKey: string; // Payment API key, "" in mock mode
  merchantId: string;
  merchantRedirect: string;
}

/** Thrown by clients with an LLM-friendly message. Never contains secrets. */
export class KashierError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "KashierError";
  }
}

// POST /v3/payment/sessions
export interface CreateSessionInput {
  amount: string; // "100.00", EGP
  order: string; // merchant order reference, unique
  expireAt: string; // ISO 8601, future
  customer: { email: string; reference: string };
  metaData?: Record<string, unknown>;
  description?: string;
}
export interface PaymentSession {
  _id: string;
  status: string; // SessionStatus
  expireAt: string;
  sessionUrl: string;
  paymentParams?: { amount?: string; currency?: string; order?: string };
}

// GET /v3/payment/sessions/{id}/payment  -> { message, data }
export interface PaymentSessionDetails {
  sessionId: string;
  status: string; // CREATED | OPENED | PENDING | PAID | FAILED | EXPIRED | ...
  createdAt: string;
  updatedAt: string;
  merchantOrderId: string;
  amount: string;
  currency: string;
  method?: string;
  orderId?: string; // "NA" until paid
}

// GET /v3/payment/orders?search=  -> { status, message, data: ReconciledOrder[], pagination }
export interface ReconciledOrderTransaction {
  operation?: string;
  status?: string;
  transactionId?: string;
  transactionResponseCode?: string;
  amount?: number | string;
  date?: string;
  [k: string]: unknown;
}
export interface ReconciledOrder {
  merchantOrderId: string;
  orderId: string;
  orderReference?: string;
  status: string; // OrderStatus: INITIATED | CAPTURED | AUTHORIZED | FAILED | CANCELLED | REVERSED | EXPIRED | REJECTED
  transactions?: ReconciledOrderTransaction[];
  [k: string]: unknown;
}

export interface Pagination {
  total?: number;
  limit?: number;
  page?: number;
  pages?: number;
}

// GET /v2/aggregator/transactions  -> { body: TransactionRecord[], pagination, message }
export interface ListTransactionsQuery {
  page?: number;
  limit?: number;
  status?: "approved" | "rejected" | "unknown";
  type?: "payment" | "refund";
  sortBy?: string; // we use "date"
  sortType?: 1 | -1;
  currency?: string;
  search?: string;
}
export interface TransactionRecord {
  transactionId: string;
  merchantOrderId?: string;
  orderReference?: string;
  id?: string; // Kashier order id
  status: string; // "Approved" | "Rejected" | "Unknown"
  type?: string; // "PAYMENT" | "REFUND"
  method?: string;
  currency?: string;
  amount?: number | string;
  totalCapturedAmount?: number | string;
  totalRefundedAmount?: number | string;
  totalAuthorizedAmount?: number | string;
  date: string; // ISO
  sourceOfFunds?: { cardInfo?: { maskedCard?: string; cardBrand?: string } };
  [k: string]: unknown;
}

// GET /v2/aggregator/transactions/{id}  -> { body, message }
export interface TransactionDetails {
  transactionId: string;
  merchantOrderId?: string | number;
  status?: string;
  currency?: string;
  amount?: number | string;
  date?: string;
  trxType?: string;
  order?: { orderId?: string; orderReference?: string };
  sourceOfFunds?: { maskedCard?: string; cardBrand?: string };
  [k: string]: unknown;
}

// PUT /v3/payment/refund/{orderId}  -> OrderOperationResult
export interface RefundResult {
  status?: string; // "SUCCESS" when processed
  response?: {
    status?: string; // SUCCESS | PENDING | FAILURE
    transactionId?: string;
    amount?: number;
    currency?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Implemented by HttpKashierClient (client.ts) and MockKashierClient (mock.ts). Returns unwrapped payloads. */
export interface KashierClient {
  createSession(input: CreateSessionInput): Promise<PaymentSession>;
  getSessionDetails(sessionId: string): Promise<PaymentSessionDetails>;
  searchOrders(search: string): Promise<ReconciledOrder[]>;
  listTransactions(q: ListTransactionsQuery): Promise<{ items: TransactionRecord[]; pagination: Pagination }>;
  getTransaction(transactionId: string): Promise<TransactionDetails>;
  refundOrder(orderId: string, amount: number, reason?: string): Promise<RefundResult>;
}
