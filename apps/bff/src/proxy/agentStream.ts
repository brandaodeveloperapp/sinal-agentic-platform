import { Readable } from "node:stream";

import type { Response } from "express";

import type { Config } from "../config.js";
import { CORRELATION_HEADER, SESSION_HEADER, type Logger } from "../logger.js";

export interface StreamRequest {
  message: string;
  sessionId: string;
  subject: string;
  downstreamToken: string;
  correlationId: string;
}

export interface AgentStreamerDeps {
  config: Config;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

/**
 * Streams the agent answer through to the browser.
 *
 * The gateway never buffers the body: it forwards the SSE frames as they arrive so
 * the first token reaches the user without waiting for the turn to finish. If the
 * agent is unreachable the client still receives a well formed SSE error frame
 * instead of a dangling connection.
 */
export class AgentStreamer {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: AgentStreamerDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async pipe(request: StreamRequest, res: Response): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.config.AGENT_TIMEOUT_MS);
    res.on("close", () => controller.abort());

    const startedAt = Date.now();

    try {
      const upstream = await this.fetchImpl(`${this.deps.config.AGENT_URL}/v1/chat/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${request.downstreamToken}`,
          [CORRELATION_HEADER]: request.correlationId,
          [SESSION_HEADER]: request.sessionId,
        },
        body: JSON.stringify({
          message: request.message,
          session_id: request.sessionId,
          subject: request.subject,
        }),
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        this.deps.logger.warn(
          { upstream_status: upstream.status },
          "agent_stream_rejected",
        );
        writeFrame(res, "error", {
          code: "agent_unavailable",
          message: "The assistant is unavailable right now. Please try again shortly.",
        });
        writeFrame(res, "done", { stop_reason: "error" });
        res.end();
        return;
      }

      this.openStream(res);
      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);

      for await (const chunk of nodeStream) {
        res.write(chunk);
      }
      res.end();

      this.deps.logger.info(
        { latency_ms: Date.now() - startedAt, outcome: "completed" },
        "agent_stream_finished",
      );
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      this.deps.logger.warn(
        { outcome: aborted ? "aborted" : "failed", latency_ms: Date.now() - startedAt },
        "agent_stream_failed",
      );
      if (!res.headersSent) {
        this.openStream(res);
      }
      if (!res.writableEnded) {
        writeFrame(res, "error", {
          code: aborted ? "agent_timeout" : "agent_unavailable",
          message: "The assistant did not finish the answer. Please try again.",
        });
        writeFrame(res, "done", { stop_reason: "error" });
        res.end();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private openStream(res: Response): void {
    res.status(200);
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();
  }
}

export function writeFrame(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
