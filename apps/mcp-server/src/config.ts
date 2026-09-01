import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8082),
  ENVIRONMENT: z.enum(["dev", "hom", "prd"]).default("dev"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SERVICE_NAME: z.string().default("sinal-mcp-server"),

  API_TELECOM_URL: z.string().url().default("http://localhost:8081"),
  API_TELECOM_KEY: z.string().default("dev-mcp-server-key"),

  JWT_ISSUER: z.string().default("https://sinal.local/idp"),
  JWT_AUDIENCE: z.string().default("sinal-mcp"),
  JWT_SIGNING_SECRET: z.string().min(16).default("dev-only-signing-secret-change-me"),

  TOOL_CALL_TIMEOUT_MS: z.coerce.number().default(8000),
  TOOL_CALL_MAX_RETRIES: z.coerce.number().default(2),
  BREAKER_FAILURE_THRESHOLD: z.coerce.number().default(5),
  BREAKER_COOLDOWN_MS: z.coerce.number().default(15000),
  UPSTREAM_CACHE_TTL_MS: z.coerce.number().default(3000),
});

export type Config = z.infer<typeof schema>;

const DEV_DEFAULTS: Record<string, string> = {
  JWT_SIGNING_SECRET: "dev-only-signing-secret-change-me",
  API_TELECOM_KEY: "dev-mcp-server-key",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid configuration: ${issues}`);
  }
  const config = parsed.data;
  if (config.ENVIRONMENT !== "dev") {
    for (const [name, devValue] of Object.entries(DEV_DEFAULTS)) {
      if (config[name as keyof Config] === devValue) {
        throw new Error(`${name} still holds its development default while ENVIRONMENT=${config.ENVIRONMENT}`);
      }
    }
  }
  return config;
}
