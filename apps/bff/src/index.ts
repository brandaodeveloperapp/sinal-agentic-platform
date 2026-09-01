import { createApp } from "./app.js";
import { Directory } from "./auth/directory.js";
import { TokenService } from "./auth/tokens.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { AgentStreamer } from "./proxy/agentStream.js";
import { RateLimiter } from "./rateLimit.js";

const config = loadConfig();
const logger = createLogger(config.SERVICE_NAME, config.ENVIRONMENT, config.LOG_LEVEL);

const app = createApp({
  config,
  logger,
  directory: new Directory(config.DEMO_PASSWORD),
  tokens: new TokenService(config),
  streamer: new AgentStreamer({ config, logger }),
  limiter: new RateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  }),
  loginLimiter: new RateLimiter({
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  }),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, agent: config.AGENT_URL }, "bff_started");
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "bff_stopping");
    server.close(() => process.exit(0));
  });
}
