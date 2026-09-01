export interface AuthenticatedUser {
  subject: string;
  displayName: string;
  actor: "subscriber" | "attendant";
  customerId: string | null;
  scopes: string[];
}

export type TurnEvent =
  | { type: "ready"; tools: string[]; model: string }
  | { type: "route"; specialist: string; tools: string[] }
  | { type: "tool_call"; name: string }
  | { type: "token"; text: string }
  | { type: "done"; stopReason: string; latencyMs: number; totalTokens: number }
  | { type: "error"; message: string };

export interface TurnStats {
  latencyMs: number;
  totalTokens: number;
  stopReason: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  toolCalls: string[];
  specialist?: string;
  stats?: TurnStats;
  failed?: boolean;
}
