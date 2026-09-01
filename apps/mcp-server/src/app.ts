import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express, type Request, type Response } from "express";

import type { TokenVerifier} from "./auth/tokens.js";
import { AuthenticationError, issueToken, SCOPES, type Scope } from "./auth/tokens.js";
import type { Config } from "./config.js";
import {
  CORRELATION_HEADER,
  SESSION_HEADER,
  newCorrelationId,
  runWithContext,
  type Logger,
} from "./logger.js";
import { createMcpServer, visibleToolNames } from "./server.js";
import type { TelecomClient } from "./upstream/telecomClient.js";

export interface AppDeps {
  config: Config;
  logger: Logger;
  client: TelecomClient;
  verifier: TokenVerifier;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "sinal-mcp-server", environment: deps.config.ENVIRONMENT });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const correlationId = (req.header(CORRELATION_HEADER) ?? newCorrelationId()).slice(0, 128);
    const sessionId = (req.header(SESSION_HEADER) ?? "").slice(0, 128);
    res.setHeader(CORRELATION_HEADER, correlationId);

    await runWithContext({ correlationId, sessionId }, async () => {
      let caller;
      try {
        caller = await deps.verifier.verify(req.header("authorization"));
      } catch (error) {
        const status = error instanceof AuthenticationError ? error.status : 401;
        deps.logger.warn({ reason: String(error) }, "mcp_request_unauthenticated");
        res.status(status).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "unauthorized" },
          id: null,
        });
        return;
      }

      const context = { correlationId, sessionId, callerSub: caller.subject };
      await runWithContext(context, async () => {
        const tools = visibleToolNames(caller);
        deps.logger.info(
          { actor: caller.actor, channel: caller.channel, visible_tools: tools.length },
          "mcp_session_opened",
        );

        const server = createMcpServer(caller, { client: deps.client, logger: deps.logger });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        res.on("close", () => {
          void transport.close();
          void server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
    });
  });

  if (deps.config.ENVIRONMENT === "dev") {
    app.post("/dev/token", async (req: Request, res: Response) => {
      const body = req.body as {
        subject?: string;
        scopes?: string[];
        customer_id?: string;
        actor?: "subscriber" | "attendant" | "service";
      };
      const requested = (body.scopes ?? []).filter((scope): scope is Scope =>
        (SCOPES as readonly string[]).includes(scope),
      );
      const token = await issueToken(
        {
          subject: body.subject ?? "dev-user",
          scopes: requested,
          customerId: body.customer_id,
          actor: body.actor ?? "subscriber",
        },
        {
          issuer: deps.config.JWT_ISSUER,
          audience: deps.config.JWT_AUDIENCE,
          signingSecret: deps.config.JWT_SIGNING_SECRET,
        },
      );
      res.json({ token, scopes: requested });
    });
  }

  return app;
}
