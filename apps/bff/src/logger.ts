import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import pino from "pino";

export interface RequestContext {
  correlationId: string;
  sessionId: string;
  callerSub?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const CORRELATION_HEADER = "x-correlation-id";
export const SESSION_HEADER = "x-session-id";

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function createLogger(serviceName: string, environment: string, level: string) {
  return pino({
    level,
    base: { service: serviceName, environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const ctx = storage.getStore();
      return ctx
        ? { correlation_id: ctx.correlationId, session_id: ctx.sessionId, caller_sub: ctx.callerSub }
        : {};
    },
    redact: {
      paths: ["req.headers.authorization", "headers.authorization", "*.api_key", "*.password"],
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
