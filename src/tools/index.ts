import type { z } from "zod";
import type { Config, KashierClient } from "../kashier/types.js";
import { createPaymentLink } from "./create-payment-link.js";
import { getPaymentStatus } from "./get-payment-status.js";
import { listTransactionsTool } from "./list-transactions.js";
import { salesSummary } from "./sales-summary.js";
import { refundPayment } from "./refund-payment.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  run(client: KashierClient, args: any, config: Config): Promise<string>;
}

export const tools: ToolDef[] = [createPaymentLink, getPaymentStatus, listTransactionsTool, salesSummary, refundPayment];
