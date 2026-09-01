import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import type { Config } from "../config.js";
import type { DirectoryUser } from "./directory.js";

export class SessionError extends Error {
  readonly status = 401;
}

const sessionClaims = z.object({
  sub: z.string().min(1),
  name: z.string().default(""),
  actor: z.enum(["subscriber", "attendant"]).default("subscriber"),
  customer_id: z.string().nullish(),
  scope: z.string().default(""),
});

export interface SessionIdentity {
  subject: string;
  displayName: string;
  actor: "subscriber" | "attendant";
  customerId?: string;
  scopes: string[];
}

/**
 * Issues the inbound session token and exchanges it for a downstream token.
 *
 * The two tokens are deliberately different: the session token is signed with the
 * gateway key and is only accepted by the gateway, while the downstream token is
 * signed with the resource key, is scoped to the tools the user may reach and
 * lives for minutes. A leaked session token cannot be replayed against the MCP
 * Server, and a leaked downstream token expires long before the session does.
 */
export class TokenService {
  private readonly sessionKey: Uint8Array;
  private readonly downstreamKey: Uint8Array;

  constructor(private readonly config: Config) {
    this.sessionKey = new TextEncoder().encode(config.SESSION_SECRET);
    this.downstreamKey = new TextEncoder().encode(config.DOWNSTREAM_SECRET);
  }

  async issueSession(user: DirectoryUser): Promise<string> {
    return new SignJWT({
      name: user.displayName,
      actor: user.actor,
      customer_id: user.customerId,
      scope: user.scopes.join(" "),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.subject)
      .setIssuer(this.config.SESSION_ISSUER)
      .setAudience(this.config.SESSION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(this.config.SESSION_TTL)
      .sign(this.sessionKey);
  }

  async verifySession(authorization: string | undefined): Promise<SessionIdentity> {
    if (!authorization?.startsWith("Bearer ")) {
      throw new SessionError("missing bearer token");
    }
    const token = authorization.slice("Bearer ".length).trim();

    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.sessionKey, {
        issuer: this.config.SESSION_ISSUER,
        audience: this.config.SESSION_AUDIENCE,
        algorithms: ["HS256"],
      }));
    } catch (error) {
      throw new SessionError(
        `session rejected: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    const parsed = sessionClaims.safeParse(payload);
    if (!parsed.success) {
      throw new SessionError("session claims failed validation");
    }

    return {
      subject: parsed.data.sub,
      displayName: parsed.data.name,
      actor: parsed.data.actor,
      customerId: parsed.data.customer_id ?? undefined,
      scopes: parsed.data.scope.split(" ").filter(Boolean),
    };
  }

  async exchangeForDownstream(identity: SessionIdentity): Promise<string> {
    return new SignJWT({
      scope: identity.scopes.join(" "),
      customer_id: identity.customerId,
      actor: identity.actor,
      channel: "web",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(identity.subject)
      .setIssuer(this.config.DOWNSTREAM_ISSUER)
      .setAudience(this.config.DOWNSTREAM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(this.config.DOWNSTREAM_TTL)
      .sign(this.downstreamKey);
  }
}
