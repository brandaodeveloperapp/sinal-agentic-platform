import { readSse, type SseFrame } from "./sse.js";
import type { AuthenticatedUser, TurnEvent } from "../types.js";

const BASE_URL = (import.meta.env?.VITE_BFF_URL as string | undefined) ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface LoginResult {
  accessToken: string;
  user: AuthenticatedUser;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? "Invalid username or password." : "Sign-in is unavailable.",
      response.status,
    );
  }

  const body = (await response.json()) as {
    access_token: string;
    user: {
      subject: string;
      display_name: string;
      actor: "subscriber" | "attendant";
      customer_id: string | null;
      scopes: string[];
    };
  };

  return {
    accessToken: body.access_token,
    user: {
      subject: body.user.subject,
      displayName: body.user.display_name,
      actor: body.user.actor,
      customerId: body.user.customer_id,
      scopes: body.user.scopes,
    },
  };
}

export interface StreamOptions {
  token: string;
  message: string;
  sessionId: string;
  signal?: AbortSignal;
}

export async function* streamTurn(options: StreamOptions): AsyncGenerator<TurnEvent> {
  const response = await fetch(`${BASE_URL}/v1/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify({ message: options.message, session_id: options.sessionId }),
    signal: options.signal,
  });

  if (response.status === 429) {
    throw new ApiError("Too many messages in a short time. Wait a moment and try again.", 429);
  }
  if (response.status === 401) {
    throw new ApiError("Your session expired. Sign in again.", 401);
  }
  if (!response.ok || !response.body) {
    throw new ApiError("The assistant is unavailable right now.", response.status);
  }

  for await (const frame of readSse(response.body)) {
    const event = toTurnEvent(frame);
    if (event) yield event;
  }
}

function toTurnEvent(frame: SseFrame): TurnEvent | null {
  const data = frame.data as Record<string, unknown>;
  switch (frame.event) {
    case "ready":
      return { type: "ready", tools: (data.tools as string[]) ?? [], model: String(data.model_id ?? "") };
    case "route":
      return {
        type: "route",
        specialist: String(data.specialist ?? ""),
        tools: (data.tools as string[]) ?? [],
      };
    case "tool_call":
      return { type: "tool_call", name: String(data.name ?? "") };
    case "token":
      return { type: "token", text: String(data.text ?? "") };
    case "done":
      return {
        type: "done",
        stopReason: String(data.stop_reason ?? "end_turn"),
        latencyMs: Number(data.latency_ms ?? 0),
        totalTokens: Number((data.usage as Record<string, number> | undefined)?.total_tokens ?? 0),
      };
    case "error":
      return { type: "error", message: String(data.message ?? "Something went wrong.") };
    default:
      return null;
  }
}
