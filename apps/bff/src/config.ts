import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  ENVIRONMENT: z.enum(["dev", "hom", "prd"]).default("dev"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SERVICE_NAME: z.string().default("sinal-bff"),

  AGENT_URL: z.string().url().default("http://localhost:8083"),
  AGENT_TIMEOUT_MS: z.coerce.number().default(60000),

  SESSION_ISSUER: z.string().default("https://sinal.local/idp"),
  SESSION_AUDIENCE: z.string().default("sinal-bff"),
  SESSION_SECRET: z.string().min(16).default("dev-only-session-secret-change-me"),
  SESSION_TTL: z.string().default("30m"),

  DOWNSTREAM_ISSUER: z.string().default("https://sinal.local/idp"),
  DOWNSTREAM_AUDIENCE: z.string().default("sinal-mcp"),
  DOWNSTREAM_SECRET: z.string().min(16).default("dev-only-signing-secret-change-me"),
  DOWNSTREAM_TTL: z.string().default("5m"),

  DEMO_PASSWORD: z.string().min(6).default("demo1234"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(20),

  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid configuration: ${issues}`);
  }
  if (parsed.data.ENVIRONMENT === "prd") {
    assertNotDefault(parsed.data.SESSION_SECRET, "SESSION_SECRET");
    assertNotDefault(parsed.data.DOWNSTREAM_SECRET, "DOWNSTREAM_SECRET");
    assertNotDefault(parsed.data.DEMO_PASSWORD, "DEMO_PASSWORD");
  }
  return parsed.data;
}

function assertNotDefault(value: string, name: string): void {
  if (value.startsWith("dev-only") || value === "demo1234") {
    throw new Error(`${name} still holds its development default while ENVIRONMENT=prd`);
  }
}

export function corsOrigins(config: Config): string[] {
  return config.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
