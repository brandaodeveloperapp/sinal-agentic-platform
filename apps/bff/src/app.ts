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
    const correlationId = (req.header(CORRELATION_HEADER) ?? newCorrelationId()).slice(0, 128);
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    res.setHeader("x-content-type-options", "nosniff");
    runWithContext({ correlationId, sessionId: req.header(SESSION_HEADER) ?? "" }, () => next());
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

    const identity = req.identity as SessionIdentity;
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

  return app;
}
