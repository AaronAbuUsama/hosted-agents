import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    AGENT_CREDENTIAL_ENCRYPTION_KEY: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
    BRAINTRUST_API_KEY: z.string().min(1).optional(),
    BRAINTRUST_PROJECT_NAME: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
