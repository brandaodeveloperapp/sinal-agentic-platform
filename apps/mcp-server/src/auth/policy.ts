import type { CallerIdentity, Scope } from "./tokens.js";

export class ToolAuthorizationError extends Error {
  readonly status = 403;
  constructor(
    message: string,
    readonly code:
      | "missing_scope"
      | "customer_mismatch"
      | "no_customer_bound"
      | "resource_not_owned",
  ) {
    super(message);
  }
}

export interface ToolPolicy {
  requiredScopes: Scope[];
  customerBound: boolean;
  requiresHumanApproval: boolean;
  writes: boolean;
}

export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  list_plans: {
    requiredScopes: ["catalog:read"],
    customerBound: false,
    requiresHumanApproval: false,
    writes: false,
  },
  search_knowledge_base: {
    requiredScopes: ["catalog:read"],
    customerBound: false,
    requiresHumanApproval: false,
    writes: false,
  },
  get_customer_profile: {
    requiredScopes: ["customer:read"],
    customerBound: true,
    requiresHumanApproval: false,
    writes: false,
  },
  list_customer_lines: {
    requiredScopes: ["customer:read"],
    customerBound: true,
    requiresHumanApproval: false,
    writes: false,
  },
  get_line_usage: {
    requiredScopes: ["usage:read"],
    customerBound: true,
    requiresHumanApproval: false,
    writes: false,
  },
  list_invoices: {
    requiredScopes: ["billing:read"],
    customerBound: true,
    requiresHumanApproval: false,
    writes: false,
  },
  get_invoice_details: {
    requiredScopes: ["billing:read"],
    customerBound: true,
    requiresHumanApproval: false,
    writes: false,
  },
  list_support_tickets: {
    requiredScopes: ["support:read"],
    customerBound: true,
    requiresHumanApproval: false,
    writes: false,
  },
  open_support_ticket: {
    requiredScopes: ["support:write"],
    customerBound: true,
    requiresHumanApproval: true,
    writes: true,
  },
};

export function isToolVisible(toolName: string, caller: CallerIdentity): boolean {
  const policy = TOOL_POLICIES[toolName];
  if (!policy) return false;
  return policy.requiredScopes.every((scope) => caller.scopes.has(scope));
}

export function authorizeToolCall(toolName: string, caller: CallerIdentity): ToolPolicy {
  const policy = TOOL_POLICIES[toolName];
  if (!policy) {
    throw new ToolAuthorizationError(`unknown tool ${toolName}`, "missing_scope");
  }
  const missing = policy.requiredScopes.filter((scope) => !caller.scopes.has(scope));
  if (missing.length > 0) {
    throw new ToolAuthorizationError(
      `caller lacks required scope(s): ${missing.join(", ")}`,
      "missing_scope",
    );
  }
  return policy;
}

export function resolveCustomerId(caller: CallerIdentity, requested?: string): string {
  if (!requested) {
    if (!caller.customerId) {
      throw new ToolAuthorizationError(
        "token carries no customer binding and no customer was requested",
        "no_customer_bound",
      );
    }
    return caller.customerId;
  }
  if (requested === caller.customerId) {
    return requested;
  }
  if (caller.scopes.has("customer:any")) {
    return requested;
  }
  throw new ToolAuthorizationError(
    "caller may only access the customer bound to its own token",
    "customer_mismatch",
  );
}

export function assertOwnership(
  ownerCustomerId: string,
  resolvedCustomerId: string,
  resourceLabel: string,
): void {
  if (ownerCustomerId !== resolvedCustomerId) {
    throw new ToolAuthorizationError(
      `${resourceLabel} does not belong to customer ${resolvedCustomerId}`,
      "resource_not_owned",
    );
  }
}
