import { describe, expect, it } from "vitest";

import {
  ToolAuthorizationError,
  assertOwnership,
  authorizeToolCall,
  isToolVisible,
  resolveCustomerId,
} from "../src/auth/policy.js";
import type { CallerIdentity, Scope } from "../src/auth/tokens.js";

function caller(scopes: Scope[], customerId?: string): CallerIdentity {
  return {
    subject: "user-1",
    scopes: new Set(scopes),
    customerId,
    actor: "subscriber",
    channel: "canal-app",
  };
}

describe("tool visibility", () => {
  it("hides tools whose scopes the caller lacks", () => {
    const subscriber = caller(["catalog:read"]);
    expect(isToolVisible("list_plans", subscriber)).toBe(true);
    expect(isToolVisible("list_invoices", subscriber)).toBe(false);
    expect(isToolVisible("open_support_ticket", subscriber)).toBe(false);
  });

  it("treats unknown tools as invisible", () => {
    expect(isToolVisible("drop_database", caller(["catalog:read"]))).toBe(false);
  });
});

describe("tool authorization", () => {
  it("rejects a call whose scope is missing even if the tool name is guessed", () => {
    expect(() => authorizeToolCall("open_support_ticket", caller(["support:read"]))).toThrow(
      ToolAuthorizationError,
    );
  });

  it("rejects unknown tool names", () => {
    expect(() => authorizeToolCall("exfiltrate", caller(["customer:any"]))).toThrow(
      ToolAuthorizationError,
    );
  });

  it("accepts a call whose scopes are all present", () => {
    const policy = authorizeToolCall("open_support_ticket", caller(["support:write"]));
    expect(policy.writes).toBe(true);
    expect(policy.requiresHumanApproval).toBe(true);
  });
});

describe("customer binding", () => {
  it("falls back to the customer bound to the token", () => {
    expect(resolveCustomerId(caller(["billing:read"], "CUS-1001"))).toBe("CUS-1001");
  });

  it("denies a subscriber asking for another customer", () => {
    try {
      resolveCustomerId(caller(["billing:read"], "CUS-1001"), "CUS-2001");
      throw new Error("expected denial");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolAuthorizationError);
      expect((error as ToolAuthorizationError).code).toBe("customer_mismatch");
    }
  });

  it("allows an attendant holding customer:any", () => {
    const attendant: CallerIdentity = {
      subject: "agent-9",
      scopes: new Set<Scope>(["billing:read", "customer:any"]),
      actor: "attendant",
      channel: "canal-atendimento",
    };
    expect(resolveCustomerId(attendant, "CUS-2001")).toBe("CUS-2001");
  });

  it("allows a subscriber to name its own customer explicitly", () => {
    expect(resolveCustomerId(caller(["billing:read"], "CUS-1001"), "CUS-1001")).toBe("CUS-1001");
  });

  it("refuses when the token carries no customer and none was requested", () => {
    try {
      resolveCustomerId(caller(["billing:read"]));
      throw new Error("expected denial");
    } catch (error) {
      expect((error as ToolAuthorizationError).code).toBe("no_customer_bound");
    }
  });
});

describe("resource ownership", () => {
  it("rejects a resource owned by another customer", () => {
    try {
      assertOwnership("CUS-2001", "CUS-1001", "fatura INV-1");
      throw new Error("expected denial");
    } catch (error) {
      expect((error as ToolAuthorizationError).code).toBe("resource_not_owned");
    }
  });

  it("accepts a resource owned by the resolved customer", () => {
    expect(() => assertOwnership("CUS-1001", "CUS-1001", "fatura INV-1")).not.toThrow();
  });
});
