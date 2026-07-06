import { env } from "@hosted-agents/env/server";
import { observe, type FlueEvent, type FlueEventContext } from "@flue/runtime";
import * as Sentry from "@sentry/node";

const dsn = env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  release: env.SENTRY_RELEASE,
  tracesSampleRate: 0,
});

type TagScope = {
  setTag(key: string, value: string): void;
};

function field(source: unknown, key: string) {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  return (source as Record<string, unknown>)[key];
}

function setTag(scope: TagScope, key: string, value: unknown) {
  if (value === undefined || value === null) {
    return;
  }

  scope.setTag(key, String(value));
}

function setFlueTags(scope: TagScope, event: FlueEvent, ctx?: FlueEventContext) {
  setTag(scope, "flue.run.id", field(event, "runId") ?? field(ctx, "runId"));
  setTag(scope, "flue.instance.id", field(event, "instanceId"));
  setTag(scope, "flue.dispatch.id", field(event, "dispatchId"));
  setTag(scope, "flue.event.index", field(event, "eventIndex"));
  setTag(scope, "flue.event.type", field(event, "type"));
  setTag(scope, "flue.workflow.name", field(event, "workflowName"));
  setTag(scope, "flue.operation.id", field(event, "operationId"));
  setTag(scope, "flue.operation.kind", field(event, "operationKind"));
  setTag(scope, "flue.session", field(event, "session"));
  setTag(scope, "flue.parent.session", field(event, "parentSession"));
  setTag(scope, "flue.harness", field(event, "harness"));
  setTag(scope, "flue.task.id", field(event, "taskId"));
  setTag(scope, "flue.turn.id", field(event, "turnId"));
  setTag(scope, "flue.context.id", field(ctx, "id"));
}

function normalizeError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return error;
  }

  if (error && typeof error === "object") {
    const message = field(error, "message");
    return new Error(typeof message === "string" ? message : fallbackMessage, {
      cause: error,
    });
  }

  return new Error(typeof error === "string" ? error : fallbackMessage);
}

observe((event, ctx) => {
  if (!dsn) {
    return;
  }

  if (event.type === "run_end" && event.isError) {
    Sentry.withScope((scope) => {
      setFlueTags(scope, event, ctx);
      Sentry.captureException(normalizeError(event.error, "Flue workflow run failed"));
    });
    return;
  }

  if (event.type === "log" && event.level === "error") {
    Sentry.withScope((scope) => {
      setFlueTags(scope, event, ctx);
      const error = event.attributes?.error;

      if (error) {
        Sentry.captureException(normalizeError(error, event.message));
        return;
      }

      Sentry.captureMessage(event.message, "error");
    });
  }
});
