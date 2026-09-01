import { describe, expect, it } from "vitest";

import { AuthenticationError, TokenVerifier, issueToken } from "../src/auth/tokens.js";

const options = {
  issuer: "https://sinal.local/idp",
  audience: "sinal-mcp",
  signingSecret: "test-signing-secret-value",
};

const verifier = new TokenVerifier(options);

describe("token verification", () => {
  it("accepts a well formed token and parses its claims", async () => {
    const token = await issueToken(
      { subject: "user-1", scopes: ["billing:read"], customerId: "CUS-1001" },
      options,
    );
    const caller = await verifier.verify(`Bearer ${token}`);
    expect(caller.subject).toBe("user-1");
    expect(caller.customerId).toBe("CUS-1001");
    expect(caller.scopes.has("billing:read")).toBe(true);
  });

  it("rejects a missing authorization header", async () => {
    await expect(verifier.verify(undefined)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a header that is not a bearer token", async () => {
    await expect(verifier.verify("Basic abc")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await issueToken(
      { subject: "user-1", scopes: ["billing:read"] },
      { ...options, signingSecret: "a-completely-different-secret" },
    );
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a token issued for another audience", async () => {
    const token = await issueToken(
      { subject: "user-1", scopes: ["billing:read"] },
      { ...options, audience: "some-other-api" },
    );
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects an expired token", async () => {
    const token = await issueToken(
      { subject: "user-1", scopes: ["billing:read"], expiresIn: "-1s" },
      options,
    );
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("drops scopes that are not part of the known scope set", async () => {
    const token = await issueToken(
      { subject: "user-1", scopes: ["billing:read", "admin:everything" as never] },
      options,
    );
    const caller = await verifier.verify(`Bearer ${token}`);
    expect(caller.scopes.size).toBe(1);
    expect(caller.scopes.has("billing:read")).toBe(true);
  });
});
