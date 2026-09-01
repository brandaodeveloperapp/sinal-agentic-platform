import { Redis } from "ioredis";

import { createApp } from "./app.js";
import { Directory } from "./auth/directory.js";
import { TokenService } from "./auth/tokens.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { AgentStreamer } from "./proxy/agentStream.js";
import { RateLimiter, RedisRateLimiter, type RateLimiterLike } from "./rateLimit.js";

const config = loadConfig();
const logger = createLogger(config.SERVICE_NAME, config.ENVIRONMENT, config.LOG_LEVEL);

// With Redis the rate-limit budget is shared across every replica; without it each
// replica keeps its own window (correct for a single replica, the local default).
let limiter: RateLimiterLike;
let loginLimiter: RateLimiterLike;
if (config.REDIS_URL) {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  redis.on("error", (error) => logger.warn({ reason: String(error) }, "redis_error"));
  limiter = new RedisRateLimiter(redis, {
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
    prefix: "rl:chat",
  });
  loginLimiter = new RedisRateLimiter(redis, {
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    prefix: "rl:login",
  });
  logger.info({ store: "redis" }, "rate_limiter_backend");
} else {
  limiter = new RateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  });
  loginLimiter = new RateLimiter({
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  });
  logger.info({ store: "memory" }, "rate_limiter_backend");
}

const app = createApp({
  config,
  logger,
  directory: new Directory(config.DEMO_PASSWORD),
  tokens: new TokenService(config),
  streamer: new AgentStreamer({ config, logger }),
  limiter,
  loginLimiter,
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
