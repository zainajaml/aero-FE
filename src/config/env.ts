import { z } from "zod";

const KNOWN_WEAK_SECRETS = new Set(["changeme", "secret", "development-secret", "test"]);

const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    APP_URL: z.url(),
    API_URL: z.url(),
    CORS_ORIGINS: csv,

    AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    SUPER_ADMIN_EMAIL_DOMAIN: z.string().min(1).default("spacemanconsulting.com"),

    SMTP_URL: z.string().min(1),
    EMAIL_FROM: z.string().min(3),

    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    FILE_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(3_600),

    BILLING_API_URL: z.url().optional(),
    BILLING_API_KEY: optionalString,
    BILLING_TENANT_ID: optionalString,

    GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
    AI_SUMMARY_MODEL: z.string().min(1).default("gemini-3-flash-preview"),

    JIRA_CLIENT_ID: optionalString,
    JIRA_CLIENT_SECRET: optionalString,
    JIRA_REDIRECT_URI: z.url().optional(),
    JIRA_TOKEN_ENCRYPTION_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      });
    }
    if (env.BILLING_API_KEY && (!env.BILLING_API_URL || !env.BILLING_TENANT_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["BILLING_API_URL"],
        message: "BILLING_API_URL and BILLING_TENANT_ID are required with BILLING_API_KEY",
      });
    }
    const jira = [
      env.JIRA_CLIENT_ID,
      env.JIRA_CLIENT_SECRET,
      env.JIRA_REDIRECT_URI,
      env.JIRA_TOKEN_ENCRYPTION_KEY,
    ];
    if (jira.some(Boolean) && !jira.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["JIRA_CLIENT_ID"],
        message: "Set all JIRA_* variables or none",
      });
    }
    if (env.JIRA_TOKEN_ENCRYPTION_KEY && env.JIRA_TOKEN_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["JIRA_TOKEN_ENCRYPTION_KEY"],
        message: "Must be at least 32 characters",
      });
    }
    if (env.NODE_ENV === "production" && KNOWN_WEAK_SECRETS.has(env.AUTH_SECRET.toLowerCase())) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET is a known weak value",
      });
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
