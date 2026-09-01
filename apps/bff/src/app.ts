import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { Directory } from "./auth/directory.js";
import { SessionError, type SessionIdentity, type TokenService } from "./auth/tokens.js";
import { corsOrigins, type Config } from "./config.js";
import {
  CORRELATION_HEADER,
  SESSION_HEADER,
  newCorrelationId,
  runWithContext,
  type Logger,
} from "./logger.js";
import type { AgentStreamer } from "./proxy/agentStream.js";
import type { RateLimiter } from "./rateLimit.js";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  session_id: z.string().min(6).max(128),
});

export interface AppDeps {
  config: Config;
  logger: Logger;
  directory: Directory;
  tokens: TokenService;
  streamer: AgentStreamer;
  limiter: RateLimiter;
  loginLimiter: RateLimiter;
}

declare module "express-serve-static-core" {
  interface Request {
    identity?: SessionIdentity;
    correlationId?: string;
  }
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(
    cors({
      origin: corsOrigins(deps.config),
      methods: ["GET", "POST"],
      allowedHeaders: ["content-type", "authorization", CORRELATION_HEADER],
      maxAge: 600,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    // A client-supplied correlation id is echoed into a response header and forwarded
    // to two upstreams, so it is constrained to a safe charset; anything else is
    // replaced with a fresh id rather than trusted.
    const supplied = req.header(CORRELATION_HEADER) ?? "";
    const correlationId = /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : newCorrelationId();
    const suppliedSession = req.header(SESSION_HEADER) ?? "";
    const sessionId = /^[A-Za-z0-9._-]{1,128}$/.test(suppliedSession) ? suppliedSession : "";
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    runWithContext({ correlationId, sessionId }, () => next());
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "sinal-bff", environment: deps.config.ENVIRONMENT });
  });

  app.post("/v1/auth/login", async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_payload", message: "username and password required" });
      return;
    }

    // Login is rate limited before the KDF runs, keyed by client IP and username, so
    // it is neither a credential brute-force surface nor an unauthenticated scrypt DoS.
    const loginKey = `${clientIp(req)}:${parsed.data.username}`;
    const loginVerdict = deps.loginLimiter.check(loginKey);
    if (!loginVerdict.allowed) {
      deps.logger.warn({ username: parsed.data.username }, "login_rate_limited");
      res.setHeader("retry-after", String(Math.ceil(loginVerdict.retryAfterMs / 1000)));
      res.status(429).json({ code: "rate_limited", message: "too many attempts" });
      return;
    }

    const user = await deps.directory.authenticate(parsed.data.username, parsed.data.password);
    if (!user) {
      deps.logger.warn({ username: parsed.data.username }, "login_rejected");
      res.status(401).json({ code: "invalid_credentials", message: "invalid credentials" });
      return;
    }

    const token = await deps.tokens.issueSession(user);
    deps.logger.info({ subject: user.subject, actor: user.actor }, "login_succeeded");
    res.json({
      access_token: token,
      token_type: "Bearer",
      user: {
        subject: user.subject,
        display_name: user.displayName,
        actor: user.actor,
        customer_id: user.customerId ?? null,
        scopes: user.scopes,
      },
    });
  });

  const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.identity = await deps.tokens.verifySession(req.header("authorization"));
      next();
    } catch (error) {
      const status = error instanceof SessionError ? error.status : 401;
      deps.logger.warn({ reason: String(error) }, "session_rejected");
      res.status(status).json({ code: "unauthorized", message: "authentication required" });
    }
  };

  app.get("/v1/auth/me", authenticate, (req: Request, res: Response) => {
    const identity = req.identity as SessionIdentity;
    res.json({
      subject: identity.subject,
      display_name: identity.displayName,
      actor: identity.actor,
      customer_id: identity.customerId ?? null,
      scopes: identity.scopes,
    });
  });

  app.post("/v1/chat/stream", authenticate, async (req: Request, res: Response) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_payload", message: "message and session_id required" });
      return;
    }

    const sessionIdentity = req.identity as SessionIdentity;

    // Re-resolve the caller's current scopes and customer binding from the directory
    // at exchange time. A privilege change (or a removed account) takes effect on the
    // next request instead of living on inside a still-valid session token.
    const current = deps.directory.findBySubject(sessionIdentity.subject);
    if (!current) {
      deps.logger.warn({ subject: sessionIdentity.subject }, "subject_no_longer_exists");
      res.status(401).json({ code: "unauthorized", message: "authentication required" });
      return;
    }
    const identity: SessionIdentity = {
      subject: current.subject,
      displayName: current.displayName,
      actor: current.actor,
      customerId: current.customerId,
      scopes: current.scopes,
    };

    const verdict = deps.limiter.check(identity.subject);
    res.setHeader("x-ratelimit-remaining", String(verdict.remaining));
    if (!verdict.allowed) {
      deps.logger.warn({ subject: identity.subject }, "rate_limited");
      res.setHeader("retry-after", String(Math.ceil(verdict.retryAfterMs / 1000)));
      res.status(429).json({ code: "rate_limited", message: "too many requests" });
      return;
    }

    const downstreamToken = await deps.tokens.exchangeForDownstream(identity);
    await deps.streamer.pipe(
      {
        message: parsed.data.message,
        sessionId: parsed.data.session_id,
        subject: identity.subject,
        downstreamToken,
        correlationId: req.correlationId ?? newCorrelationId(),
      },
      res,
    );
  });

  // Terminal handler: a body-parser or unexpected error becomes a generic JSON
  // response, never Express's default HTML stack trace.
  app.use((error: Error & { status?: number; type?: string }, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = error.type === "entity.too.large" ? 413 : (error.status ?? 400);
    deps.logger.warn({ reason: error.type ?? error.name }, "request_failed");
    res.status(status >= 400 && status < 600 ? status : 500).json({
      code: "bad_request",
      message: "The request could not be processed.",
    });
  });

  return app;
}

function clientIp(req: Request): string {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket.remoteAddress ?? "unknown";
}
