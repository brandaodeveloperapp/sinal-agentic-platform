import { z } from "zod";

import { assertOwnership, resolveCustomerId } from "../auth/policy.js";
import { maskEmail, sanitizeUntrustedText } from "../redaction.js";
import type { ToolDefinition } from "./types.js";

const customerIdArg = {
  customer_id: z
    .string()
    .optional()
    .describe(
      "Identificador do cliente. Omita para usar o cliente vinculado ao token. " +
        "Informar outro cliente exige escopo customer:any e sera negado caso contrario.",
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
    title: "Listar planos",
    description: "Lista os planos comercializados pela operadora. Nao expoe dado de cliente algum.",
    inputSchema: {},
    readOnly: true,
    handler: async (_args, { client, caller }) => {
      const plans = await client.request<PlanPayload[]>({
        path: "/v1/plans",
        actingUser: caller.subject,
      });
      return { summary: `${plans.length} planos disponiveis.`, data: { plans } };
    },
  },
  {
    name: "get_customer_profile",
    title: "Consultar cadastro do cliente",
    description: "Retorna o cadastro do cliente com documento e e-mail mascarados.",
    inputSchema: { ...customerIdArg },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const customer = await client.request<CustomerPayload>({
        path: `/v1/customers/${encodeURIComponent(customerId)}`,
        actingUser: caller.subject,
      });
      return {
        summary: `Cliente ${customer.full_name}, segmento ${customer.segment}.`,
        data: { customer: { ...customer, email: maskEmail(customer.email) } },
      };
    },
  },
  {
    name: "list_customer_lines",
    title: "Listar linhas do cliente",
    description: "Lista as linhas moveis do cliente com plano e situacao atual.",
    inputSchema: { ...customerIdArg },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const lines = await client.request<LinePayload[]>({
        path: `/v1/customers/${encodeURIComponent(customerId)}/lines`,
        actingUser: caller.subject,
      });
      return {
        summary: `${lines.length} linhas encontradas para ${customerId}.`,
        data: { lines },
      };
    },
  },
  {
    name: "get_line_usage",
    title: "Consultar consumo da linha",
    description:
      "Retorna o consumo do ciclo vigente de uma linha. A linha precisa pertencer ao cliente autorizado.",
    inputSchema: {
      msisdn: z.string().min(10).max(15).describe("Numero da linha em E.164 sem o sinal de mais"),
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
      assertOwnership(owned?.customer_id ?? "", customerId, `linha ${msisdn}`);

      const usage = await client.request<UsagePayload>({
        path: `/v1/lines/${encodeURIComponent(msisdn)}/usage`,
        actingUser: caller.subject,
      });
      const remaining = usage.data_allowance_gb - Number(usage.data_used_gb);
      return {
        summary:
          `Linha ${msisdn} usou ${usage.data_used_gb}GB de ${usage.data_allowance_gb}GB, ` +
          `restam ${remaining.toFixed(1)}GB.`,
        data: { usage, data_remaining_gb: Number(remaining.toFixed(2)) },
      };
    },
  },
  {
    name: "list_invoices",
    title: "Listar faturas",
    description: "Lista as faturas do cliente, com filtro opcional por situacao.",
    inputSchema: {
      status: z.enum(["open", "paid", "overdue"]).optional().describe("Filtro por situacao"),
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
            ? `${invoices.length} faturas, ${overdue.length} em atraso.`
            : `${invoices.length} faturas, nenhuma em atraso.`,
        data: { invoices },
      };
    },
  },
  {
    name: "get_invoice_details",
    title: "Detalhar fatura",
    description: "Retorna uma fatura especifica. A fatura precisa pertencer ao cliente autorizado.",
    inputSchema: {
      invoice_id: z.string().min(3).describe("Identificador da fatura"),
      ...customerIdArg,
    },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const invoice = await client.request<InvoicePayload>({
        path: `/v1/invoices/${encodeURIComponent(args.invoice_id as string)}`,
        actingUser: caller.subject,
      });
      assertOwnership(invoice.customer_id, customerId, `fatura ${invoice.id}`);
      return {
        summary:
          `Fatura ${invoice.id} de ${invoice.reference_month}: R$ ${invoice.amount}, ` +
          `situacao ${invoice.status}.`,
        data: { invoice },
      };
    },
  },
  {
    name: "list_support_tickets",
    title: "Listar chamados",
    description: "Lista os chamados de suporte abertos pelo cliente.",
    inputSchema: { ...customerIdArg },
    readOnly: true,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const tickets = await client.request<TicketPayload[]>({
        path: `/v1/customers/${encodeURIComponent(customerId)}/tickets`,
        actingUser: caller.subject,
      });
      return {
        summary: `${tickets.length} chamados registrados.`,
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
    title: "Abrir chamado",
    description:
      "Abre um chamado de suporte. Operacao de escrita: exige confirmacao explicita do usuario " +
      "antes de ser efetivada.",
    inputSchema: {
      category: z
        .enum(["billing", "network", "device", "plan_change"])
        .describe("Categoria do chamado"),
      summary: z.string().min(10).max(280).describe("Resumo do problema relatado"),
      confirmed: z
        .boolean()
        .default(false)
        .describe("Deve ser true apenas apos o usuario confirmar a abertura do chamado."),
      ...customerIdArg,
    },
    readOnly: false,
    handler: async (args, { client, caller }) => {
      const customerId = resolveCustomerId(caller, args.customer_id as string | undefined);
      const summary = sanitizeUntrustedText(args.summary as string, 280);

      if (args.confirmed !== true) {
        return {
          summary:
            "Confirmacao pendente. Pergunte ao usuario se pode abrir o chamado e chame a tool " +
            "novamente com confirmed=true apos a resposta afirmativa.",
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
        summary: `Chamado ${ticket.id} aberto na categoria ${ticket.category}.`,
        data: { status: "created", ticket },
      };
    },
  },
];

export const TOOL_INDEX: Map<string, ToolDefinition> = new Map(
  TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
);
