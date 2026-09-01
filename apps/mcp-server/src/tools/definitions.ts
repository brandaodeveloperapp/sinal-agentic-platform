import { z } from "zod";

import { assertOwnership, resolveCustomerId } from "../auth/policy.js";
import { maskEmail, sanitizeUntrustedText } from "../redaction.js";
import type { ToolDefinition } from "./types.js";

const customerIdArg = {
  customer_id: z
    .string()
    .optional()
    .describe(
      "Customer identifier. Omit it to use the customer bound to the caller token. " +
        "Naming a different customer requires the customer:any scope and is denied otherwise.",
    ),
};

interface CustomerPayload {
  id: string;
  full_name: string;
  document: string;
  segment: string;
  since: string;
  email: string;
}

interface LinePayload {
  msisdn: string;
  customer_id: string;
  plan_id: string;
  status: string;
  activated_at: string;
}

interface UsagePayload {
  msisdn: string;
  cycle_start: string;
  cycle_end: string;
  data_used_gb: string;
  data_allowance_gb: number;
  minutes_used: number;
  sms_used: number;
  roaming_active: boolean;
}

interface InvoicePayload {
  id: string;
  customer_id: string;
  reference_month: string;
  due_date: string;
  amount: string;
  status: string;
  barcode: string | null;
}

interface TicketPayload {
  id: string;
  customer_id: string;
  category: string;
  status: string;
  summary: string;
  opened_at: string;
  opened_by: string;
}

interface PlanPayload {
  id: string;
  name: string;
  monthly_price: string;
  data_allowance_gb: number;
  unlimited_apps: string[];
  minutes: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_plans",
    title: "List plans",
    description: "Lists the plans the carrier sells. Exposes no customer data at all.",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, { client, caller }) => {
      const plans = await client.request<PlanPayload[]>({
        path: "/v1/plans",
        actingUser: caller.subject,
      });
      return { summary: `${plans.length} plans available.`, data: { plans } };
    },
  },
  {
    name: "get_customer_profile",
    title: "Get customer profile",
    description: "Returns the customer record with document and email masked.",
    inputSchema: { ...customerIdArg },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const customer = await client.request<CustomerPayload>({
        path: `/v1/customers/${encodeURIComponent(customerId)}`,
        actingUser: caller.subject,
      });
      return {
        summary: `Customer ${customer.full_name}, segment ${customer.segment}.`,
        data: { customer: { ...customer, email: maskEmail(customer.email) } },
      };
    },
  },
  {
    name: "list_customer_lines",
    title: "List customer lines",
    description: "Lists the mobile lines owned by the customer, with plan and current status.",
    inputSchema: { ...customerIdArg },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const lines = await client.request<LinePayload[]>({
        path: `/v1/customers/${encodeURIComponent(customerId)}/lines`,
        actingUser: caller.subject,
      });
      return {
        summary: `${lines.length} lines found for ${customerId}.`,
        data: { lines },
      };
    },
  },
  {
    name: "get_line_usage",
    title: "Get line usage",
    description:
      "Returns the current cycle usage for a line. The line must belong to the authorized customer.",
    inputSchema: {
      msisdn: z.string().min(10).max(15).describe("Line number in E.164 without the plus sign"),
      ...customerIdArg,
    },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const msisdn = args.msisdn as string;

      const lines = await client.request<LinePayload[]>({
        path: `/v1/customers/${encodeURIComponent(customerId)}/lines`,
        actingUser: caller.subject,
      });
      const owned = lines.find((line) => line.msisdn === msisdn);
      assertOwnership(owned?.customer_id ?? "", customerId, `line ${msisdn}`);

      const usage = await client.request<UsagePayload>({
        path: `/v1/lines/${encodeURIComponent(msisdn)}/usage`,
        actingUser: caller.subject,
      });
      const remaining = usage.data_allowance_gb - Number(usage.data_used_gb);
      return {
        summary:
          `Line ${msisdn} used ${usage.data_used_gb}GB of ${usage.data_allowance_gb}GB, ` +
          `${remaining.toFixed(1)}GB remaining.`,
        data: { usage, data_remaining_gb: Number(remaining.toFixed(2)) },
      };
    },
  },
  {
    name: "list_invoices",
    title: "List invoices",
    description: "Lists the customer invoices, optionally filtered by status.",
    inputSchema: {
      status: z.enum(["open", "paid", "overdue"]).optional().describe("Filter by status"),
      ...customerIdArg,
    },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const invoices = await client.request<InvoicePayload[]>({
        path: `/v1/customers/${encodeURIComponent(customerId)}/invoices`,
        query: { status: args.status as string | undefined },
        actingUser: caller.subject,
      });
      const overdue = invoices.filter((invoice) => invoice.status === "overdue");
      return {
        summary:
          overdue.length > 0
            ? `${invoices.length} invoices, ${overdue.length} overdue.`
            : `${invoices.length} invoices, none overdue.`,
        data: { invoices },
      };
    },
  },
  {
    name: "get_invoice_details",
    title: "Get invoice details",
    description: "Returns one invoice. The invoice must belong to the authorized customer.",
    inputSchema: {
      invoice_id: z.string().min(3).describe("Invoice identifier"),
      ...customerIdArg,
    },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const invoice = await client.request<InvoicePayload>({
        path: `/v1/invoices/${encodeURIComponent(args.invoice_id as string)}`,
        actingUser: caller.subject,
      });
      assertOwnership(invoice.customer_id, customerId, `invoice ${invoice.id}`);
      return {
        summary:
          `Invoice ${invoice.id} for ${invoice.reference_month}: ${invoice.amount}, ` +
          `status ${invoice.status}.`,
        data: { invoice },
      };
    },
  },
  {
    name: "list_support_tickets",
    title: "List support tickets",
    description: "Lists the support tickets opened by the customer.",
    inputSchema: { ...customerIdArg },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const tickets = await client.request<TicketPayload[]>({
        path: `/v1/customers/${encodeURIComponent(customerId)}/tickets`,
        actingUser: caller.subject,
      });
      return {
        summary: `${tickets.length} tickets on record.`,
        data: {
          tickets: tickets.map((ticket) => ({
            ...ticket,
            summary: sanitizeUntrustedText(ticket.summary),
          })),
        },
      };
    },
  },
  {
    name: "open_support_ticket",
    title: "Open support ticket",
    description:
      "Opens a support ticket. Write operation: requires explicit user confirmation before it " +
      "takes effect.",
    inputSchema: {
      category: z
        .enum(["billing", "network", "device", "plan_change"])
        .describe("Ticket category"),
      summary: z.string().min(10).max(280).describe("Short description of the reported problem"),
      confirmed: z
        .boolean()
        .default(false)
        .describe("Set to true only after the user has explicitly confirmed opening the ticket."),
      ...customerIdArg,
    },
    readOnly: false,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const summary = sanitizeUntrustedText(args.summary as string, 280);

      if (args.confirmed !== true) {
        return {
          summary:
            "Confirmation pending. Ask the user whether the ticket may be opened and call this " +
            "tool again with confirmed=true once they agree.",
          data: {
            status: "confirmation_required",
            preview: { customer_id: customerId, category: args.category, summary },
          },
        };
      }

      const ticket = await client.request<TicketPayload>({
        method: "POST",
        path: "/v1/tickets",
        body: { customer_id: customerId, category: args.category, summary },
        actingUser: caller.subject,
      });
      return {
        summary: `Ticket ${ticket.id} opened under category ${ticket.category}.`,
        data: { status: "created", ticket },
      };
    },
  },
];

export const TOOL_INDEX: Map<string, ToolDefinition> = new Map(
  TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
);
