import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

export const SCOPES = [
  "catalog:read",
  "customer:read",
  "usage:read",
  "billing:read",
  "support:read",
  "support:write",
  "customer:any",
] as const;

export type Scope = (typeof SCOPES)[number];

const claimsSchema = z.object({
  sub: z.string().min(1),
  scope: z.string().default(""),
  customer_id: z.string().nullish(),
  actor: z.enum(["subscriber", "attendant", "service"]).default("subscriber"),
  channel: z.string().default("unknown"),
});

export interface CallerIdentity {
  subject: string;
  scopes: Set<Scope>;
  customerId?: string;
  actor: "subscriber" | "attendant" | "service";
  channel: string;
}

export class AuthenticationError extends Error {
  readonly status = 401;
}

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
  signingSecret: string;
}

export class TokenVerifier {
  private readonly key: Uint8Array;

  constructor(private readonly options: TokenVerifierOptions) {
    this.key = new TextEncoder().encode(options.signingSecret);
  }

  async verify(authorizationHeader: string | undefined): Promise<CallerIdentity> {
    if (!authorizationHeader?.startsWith("Bearer ")) {
      throw new AuthenticationError("missing bearer token");
    }
    const token = authorizationHeader.slice("Bearer ".length).trim();

    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["HS256"],
        requiredClaims: ["exp", "iat"],
        maxTokenAge: "30m",
      }));
    } catch (error) {
      throw new AuthenticationError(
        `token rejected: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AuthenticationError("token claims failed validation");
    }

    const granted = parsed.data.scope
      .split(" ")
      .map((s) => s.trim())
      .filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));

    return {
      subject: parsed.data.sub,
      scopes: new Set(granted),
      customerId: parsed.data.customer_id ?? undefined,
      actor: parsed.data.actor,
      channel: parsed.data.channel,
    };
  }
}

export interface IssueTokenInput {
  subject: string;
  scopes: Scope[];
  customerId?: string;
  actor?: "subscriber" | "attendant" | "service";
  channel?: string;
  expiresIn?: string;
}

export async function issueToken(
  input: IssueTokenInput,
  options: TokenVerifierOptions,
): Promise<string> {
  const key = new TextEncoder().encode(options.signingSecret);
  const builder = new SignJWT({
    scope: input.scopes.join(" "),
    customer_id: input.customerId,
    actor: input.actor ?? "subscriber",
    channel: input.channel ?? "canal-app",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.subject)
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? "15m");

  return builder.sign(key);
}
