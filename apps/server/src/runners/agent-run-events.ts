import { db } from "@hosted-agents/db";
import {
  agentRun,
  agentRunArtifact,
  agentRunEvent,
  agentRunSandbox,
} from "@hosted-agents/db/schema/agent-runs";
import { and, desc, eq } from "drizzle-orm";

type Database = typeof db;
type RunEventDatabase = Pick<Database, "select" | "insert" | "update">;
const runEventAppendQueues = new Map<string, Promise<void>>();

export type AgentRunEventCategory =
  | "github"
  | "queue"
  | "worker"
  | "sandbox"
  | "flue"
  | "model"
  | "tool"
  | "result"
  | "cleanup";

export type AppendAgentRunEventInput = {
  runId: string;
  category: AgentRunEventCategory;
  type: string;
  stage?: string | null;
  message: string;
  payload?: unknown;
  flueEventIndex?: number | null;
  flueEventType?: string | null;
};

function toPayloadJson(payload: unknown) {
  if (payload === undefined) {
    return null;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function flueEventMessage(event: unknown) {
  const record = asRecord(event);
  const type = typeof record.type === "string" ? record.type : "unknown";

  if (typeof record.message === "string") {
    return record.message;
  }

  if (type === "tool_start" || type === "tool") {
    const toolName = typeof record.toolName === "string" ? record.toolName : "tool";
    return `${type}: ${toolName}`;
  }

  if (type === "operation_start" || type === "operation") {
    const operationKind =
      typeof record.operationKind === "string" ? record.operationKind : "operation";
    return `${type}: ${operationKind}`;
  }

  if (type === "turn_start" || type === "turn") {
    return `${type}: model turn`;
  }

  return `Flue event: ${type}`;
}

function flueEventCategory(event: unknown): AgentRunEventCategory {
  const type = asRecord(event).type;

  if (typeof type !== "string") {
    return "flue";
  }

  if (type.startsWith("tool")) {
    return "tool";
  }

  if (type.startsWith("turn") || type.startsWith("message") || type.includes("thinking")) {
    return "model";
  }

  if (type === "run_end") {
    return "result";
  }

  return "flue";
}

async function appendAgentRunEventUnlocked(
  database: RunEventDatabase,
  input: AppendAgentRunEventInput,
) {
  const [latest] = await database
    .select({ sequence: agentRunEvent.sequence })
    .from(agentRunEvent)
    .where(eq(agentRunEvent.runId, input.runId))
    .orderBy(desc(agentRunEvent.sequence))
    .limit(1);
  const sequence = (latest?.sequence ?? 0) + 1;

  await database.insert(agentRunEvent).values({
    id: crypto.randomUUID(),
    runId: input.runId,
    sequence,
    category: input.category,
    type: input.type,
    stage: input.stage ?? null,
    message: input.message,
    payloadJson: toPayloadJson(input.payload),
    flueEventIndex: input.flueEventIndex ?? null,
    flueEventType: input.flueEventType ?? null,
  });
}

export async function appendAgentRunEvent(
  database: RunEventDatabase,
  input: AppendAgentRunEventInput,
) {
  const previous = runEventAppendQueues.get(input.runId) ?? Promise.resolve();
  const next = previous.then(() => appendAgentRunEventUnlocked(database, input));
  const tracked = next.catch(() => undefined);

  runEventAppendQueues.set(input.runId, tracked);

  try {
    await next;
  } finally {
    if (runEventAppendQueues.get(input.runId) === tracked) {
      runEventAppendQueues.delete(input.runId);
    }
  }
}

export async function recordAgentRunStage(
  database: RunEventDatabase,
  input: AppendAgentRunEventInput & {
    status?: string;
  },
) {
  const values: {
    status?: string;
    currentStage: string | null;
    lastHeartbeatAt: Date;
    updatedAt: Date;
  } = {
    currentStage: input.stage ?? null,
    lastHeartbeatAt: new Date(),
    updatedAt: new Date(),
  };
  if (input.status) {
    values.status = input.status;
  }

  await database.update(agentRun).set(values).where(eq(agentRun.id, input.runId));
  await appendAgentRunEvent(database, input);
}

export async function recordAgentRunSandboxCreated(
  database: RunEventDatabase,
  input: {
    runId: string;
    provider: string;
    sandboxId: string;
    labels: Record<string, string>;
  },
) {
  await database.insert(agentRunSandbox).values({
    id: crypto.randomUUID(),
    runId: input.runId,
    provider: input.provider,
    sandboxId: input.sandboxId,
    status: "running",
    labelsJson: JSON.stringify(input.labels),
    startedAt: new Date(),
  });
  await database
    .update(agentRun)
    .set({
      sandboxProvider: input.provider,
      sandboxId: input.sandboxId,
      currentStage: "sandbox_created",
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentRun.id, input.runId));
  await appendAgentRunEvent(database, {
    runId: input.runId,
    category: "sandbox",
    type: "sandbox.created",
    stage: "sandbox_created",
    message: `Daytona sandbox ${input.sandboxId} created`,
    payload: { sandboxId: input.sandboxId, provider: input.provider, labels: input.labels },
  });
}

export async function recordAgentRunSandboxCompleted(
  database: RunEventDatabase,
  input: {
    runId: string;
    sandboxId: string;
    status: "deleted" | "delete_failed";
    errorMessage?: string;
  },
) {
  await database
    .update(agentRunSandbox)
    .set({
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(agentRunSandbox.runId, input.runId), eq(agentRunSandbox.sandboxId, input.sandboxId)),
    );
  await appendAgentRunEvent(database, {
    runId: input.runId,
    category: "cleanup",
    type: input.status === "deleted" ? "sandbox.deleted" : "sandbox.delete_failed",
    stage: "sandbox_cleanup",
    message:
      input.status === "deleted"
        ? `Daytona sandbox ${input.sandboxId} deleted`
        : `Daytona sandbox ${input.sandboxId} deletion failed`,
    payload: { sandboxId: input.sandboxId, errorMessage: input.errorMessage },
  });
}

export async function appendFlueRunEvent(
  database: RunEventDatabase,
  input: {
    runId: string;
    event: unknown;
  },
) {
  const record = asRecord(input.event);
  const type = typeof record.type === "string" ? record.type : "unknown";
  const eventIndex = typeof record.eventIndex === "number" ? record.eventIndex : null;

  await appendAgentRunEvent(database, {
    runId: input.runId,
    category: flueEventCategory(input.event),
    type: `flue.${type}`,
    stage: "flue_review",
    message: flueEventMessage(input.event),
    payload: input.event,
    flueEventIndex: eventIndex,
    flueEventType: type,
  });
}

export async function insertAgentRunArtifact(
  database: RunEventDatabase,
  input: {
    runId: string;
    name: string;
    contentType: string;
    content?: string;
    payload?: unknown;
  },
) {
  await database.insert(agentRunArtifact).values({
    id: crypto.randomUUID(),
    runId: input.runId,
    name: input.name,
    contentType: input.contentType,
    content: input.content,
    payloadJson: toPayloadJson(input.payload),
  });
}
