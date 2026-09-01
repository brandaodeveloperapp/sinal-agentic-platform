import { createApp } from "./app.js";
import { TokenVerifier } from "./auth/tokens.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { CircuitBreaker } from "./upstream/circuitBreaker.js";
import { TelecomClient } from "./upstream/telecomClient.js";
import { buildKnowledgeBase } from "./knowledge/index.js";

const config = loadConfig();
const logger = createLogger(config.SERVICE_NAME, config.ENVIRONMENT, config.LOG_LEVEL);

const breaker = new CircuitBreaker({
  failureThreshold: config.BREAKER_FAILURE_THRESHOLD,
  cooldownMs: config.BREAKER_COOLDOWN_MS,
});

const client = new TelecomClient({
  baseUrl: config.API_TELECOM_URL,
  apiKey: config.API_TELECOM_KEY,
  timeoutMs: config.TOOL_CALL_TIMEOUT_MS,
  maxRetries: config.TOOL_CALL_MAX_RETRIES,
  breaker,
  logger,
  cacheTtlMs: config.UPSTREAM_CACHE_TTL_MS,
});

const verifier = new TokenVerifier({
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  signingSecret: config.JWT_SIGNING_SECRET,
});

const knowledge = buildKnowledgeBase();
const app = createApp({ config, logger, client, verifier, knowledge });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, upstream: config.API_TELECOM_URL }, "mcp_server_started");
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "mcp_server_stopping");
    server.close(() => process.exit(0));
  });
}
