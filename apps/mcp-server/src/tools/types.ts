import type { ZodRawShape } from "zod";

import type { CallerIdentity } from "../auth/tokens.js";
import type { Logger } from "../logger.js";
import type { TelecomClient } from "../upstream/telecomClient.js";
import type { VectorStore } from "../knowledge/vectorStore.js";

export interface ToolContext {
  caller: CallerIdentity;
  client: TelecomClient;
  logger: Logger;
  knowledge: VectorStore;
}

export interface ToolOutcome {
  summary: string;
  data: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  readOnly: boolean;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolOutcome>;
}
