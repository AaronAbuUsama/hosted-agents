import { createContext } from "@hosted-agents/api/context";
import { appRouter } from "@hosted-agents/api/routers/index";
import { auth } from "@hosted-agents/auth";
import { invoke } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { env } from "@hosted-agents/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createHmac, timingSafeEqual } from "node:crypto";

import "./braintrust";
import "./sentry";
import codeReviewWorkflow from "./workflows/code-review";
import { registerPiOpenAICodexProvider } from "./lib/pi-auth";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function registerOptionalPiOpenAICodexProvider() {
  try {
    await registerPiOpenAICodexProvider();
  } catch (error) {
    console.warn(
      `[pi-auth] Skipped optional openai-codex provider registration: ${errorMessage(error)}`,
    );
  }
}

await registerOptionalPiOpenAICodexProvider();

const app = new Hono();

function verifyGitHubWebhookSignature(payload: string, signature: string | undefined) {
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return false;
  }

  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex")}`;
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    signatureBuffer.length === expectedBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedBuffer)
  );
}

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.get("/api/auth/callback/github", async (c, next) => {
  const installationId = c.req.query("installation_id");
  const setupAction = c.req.query("setup_action");

  if (!installationId || !setupAction) {
    await next();
    return;
  }

  const setupUrl = new URL("/dashboard/github/setup", env.CORS_ORIGIN);
  setupUrl.searchParams.set("installation_id", installationId);
  setupUrl.searchParams.set("setup_action", setupAction);

  const state = c.req.query("state");
  if (state) {
    setupUrl.searchParams.set("state", state);
  }

  return c.redirect(setupUrl.toString());
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/api/github/webhook", (c) => {
  return c.json({ ok: true, endpoint: "github-webhook" });
});

app.post("/api/github/webhook", async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!env.GITHUB_WEBHOOK_SECRET) {
    return c.json({ error: "GitHub webhook secret is not configured." }, 500);
  }

  if (!verifyGitHubWebhookSignature(payload, signature)) {
    return c.json({ error: "Invalid GitHub webhook signature." }, 401);
  }

  const event = c.req.header("x-github-event") ?? "unknown";
  const delivery = c.req.header("x-github-delivery") ?? "unknown";
  let action: string | undefined;
  let installationId: number | undefined;

  try {
    const json = JSON.parse(payload) as {
      action?: string;
      installation?: { id?: number };
    };
    action = json.action;
    installationId = json.installation?.id;
  } catch {
    return c.json({ error: "Invalid GitHub webhook JSON payload." }, 400);
  }

  console.info("[github-webhook] accepted", {
    event,
    action,
    delivery,
    installationId,
  });

  return c.json({ ok: true, event, action, delivery }, 202);
});

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({
    context: c,
    reviewRunInvoker: async (input) => {
      const { runId } = await invoke(codeReviewWorkflow, { input });
      return { flueRunId: runId };
    },
  });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.route("/api/flue", flue());

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
