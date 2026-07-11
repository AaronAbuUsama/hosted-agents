import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function applyEnvAlias(currentName: string, legacyName: string): void {
  if (!process.env[currentName] && process.env[legacyName]) {
    process.env[currentName] = process.env[legacyName];
  }
}

applyEnvAlias("DAYTONA_API_KEY", "DATONA_API_KEY");
applyEnvAlias("DAYTONA_API_URL", "DATONA_API_URL");

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
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_SLUG: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    GITHUB_CODER_APP_ID: z.string().min(1).optional(),
    GITHUB_CODER_APP_SLUG: z.string().min(1).optional(),
    GITHUB_CODER_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_CODER_APP_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
    DAYTONA_API_KEY: z.string().min(1).optional(),
    DAYTONA_API_URL: z.url().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
