import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ToolAuthorizationError, authorizeToolCall, isToolVisible } from "./auth/policy.js";
import type { CallerIdentity } from "./auth/tokens.js";
import type { Logger } from "./logger.js";
import { TOOL_DEFINITIONS } from "./tools/definitions.js";
import type { TelecomClient } from "./upstream/telecomClient.js";
import { CircuitOpenError } from "./upstream/circuitBreaker.js";
import { UpstreamError } from "./upstream/telecomClient.js";

export const SERVER_NAME = "sinal-mcp-server";
export const SERVER_VERSION = "0.1.0";

export interface McpServerDeps {
  client: TelecomClient;
  logger: Logger;
}

export function visibleToolNames(caller: CallerIdentity): string[] {
  return TOOL_DEFINITIONS.filter((tool) => isToolVisible(tool.name, caller)).map(
    (tool) => tool.name,
  );
}

export function createMcpServer(caller: CallerIdentity, deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Capacidades corporativas da operadora Onda Telecom. As tools visiveis ja refletem a " +
        "autorizacao do chamador: o que nao aparece aqui nao pode ser chamado.",
    },
  );

  for (const definition of TOOL_DEFINITIONS) {
    if (!isToolVisible(definition.name, caller)) continue;

    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: definition.readOnly,
          destructiveHint: !definition.readOnly,
          idempotentHint: definition.readOnly,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        try {
          authorizeToolCall(definition.name, caller);
          const outcome = await definition.handler(args ?? {}, {
            caller,
            client: deps.client,
            logger: deps.logger,
          });

          deps.logger.info(
            {
              tool: definition.name,
              outcome: "success",
              latency_ms: Date.now() - startedAt,
              actor: caller.actor,
              channel: caller.channel,
            },
            "tool_call_completed",
          );

          return {
            content: [
              { type: "text" as const, text: outcome.summary },
              { type: "text" as const, text: JSON.stringify(outcome.data) },
            ],
          };
        } catch (error) {
          const mapped = describeFailure(error);
          deps.logger.warn(
            {
              tool: definition.name,
              outcome: mapped.outcome,
              error_code: mapped.code,
              latency_ms: Date.now() - startedAt,
              actor: caller.actor,
            },
            "tool_call_failed",
          );
          return {
            content: [{ type: "text" as const, text: mapped.message }],
            isError: true,
          };
        }
      },
    );
  }

  if (caller.scopes.has("catalog:read")) {
    server.registerResource(
      "plan-catalog",
      "sinal://catalog/plans",
      {
        title: "Catalogo de planos",
        description: "Planos comercializados, servidos como recurso MCP para grounding.",
        mimeType: "application/json",
      },
      async (uri) => {
        const plans = await deps.client.request<unknown[]>({
          path: "/v1/plans",
          actingUser: caller.subject,
        });
        return {
          contents: [
            { uri: uri.href, mimeType: "application/json", text: JSON.stringify({ plans }) },
          ],
        };
      },
    );
  }

  return server;
}

interface FailureDescription {
  outcome: "denied" | "upstream_error" | "circuit_open" | "unexpected";
  code: string;
  message: string;
}

export function describeFailure(error: unknown): FailureDescription {
  if (error instanceof ToolAuthorizationError) {
    return {
      outcome: "denied",
      code: error.code,
      message: `Acesso negado: ${error.message}`,
    };
  }
  if (error instanceof CircuitOpenError) {
    return {
      outcome: "circuit_open",
      code: "circuit_open",
      message:
        "O sistema corporativo esta indisponivel no momento e as chamadas foram pausadas. " +
        "Informe o usuario e sugira tentar novamente em instantes.",
    };
  }
  if (error instanceof UpstreamError) {
    const message =
      error.status === 404
        ? `Registro nao encontrado: ${error.message}`
        : error.status === 504
          ? "O sistema corporativo demorou demais para responder. Nenhum dado foi alterado."
          : `Falha ao consultar o sistema corporativo (${error.status}). Nenhum dado foi alterado.`;
    return { outcome: "upstream_error", code: `upstream_${error.status}`, message };
  }
  return {
    outcome: "unexpected",
    code: "unexpected",
    message: "Falha inesperada ao executar a capacidade solicitada.",
  };
}
