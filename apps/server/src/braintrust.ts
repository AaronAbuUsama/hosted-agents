import { observe, type FlueEvent } from "@flue/runtime";
import { env } from "@hosted-agents/env/server";
import { braintrustFlueObserver, initLogger, setMaskingFunction } from "braintrust";

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /api[_-]?key|token|secret|password|authorization|credential|dsn|private[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret/i;
const SENSITIVE_STRING_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9_]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
];

type BraintrustFlueEvent = Parameters<typeof braintrustFlueObserver>[0];
type BraintrustFlueContext = Parameters<typeof braintrustFlueObserver>[1];

const observedRunStarts = new Set<string>();

function maskString(value: string) {
  return SENSITIVE_STRING_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
}

function maskBraintrustValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => maskBraintrustValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : maskBraintrustValue(entry, seen),
    ]),
  );
}

function compatibleEvent(event: FlueEvent): BraintrustFlueEvent | null {
  const record = event as FlueEvent & Record<string, unknown>;

  if (event.type === "run_start") {
    observedRunStarts.add(event.runId);
    return {
      ...record,
      payload: record.input,
    } as BraintrustFlueEvent;
  }

  if (event.type === "run_resume") {
    if (observedRunStarts.has(event.runId)) {
      return null;
    }

    observedRunStarts.add(event.runId);
    return {
      ...record,
      type: "run_start",
    } as BraintrustFlueEvent;
  }

  if (event.type === "run_end") {
    observedRunStarts.delete(event.runId);
  }

  if (event.type === "tool") {
    return {
      ...record,
      type: "tool_call",
    } as BraintrustFlueEvent;
  }

  return record as BraintrustFlueEvent;
}

if (env.BRAINTRUST_API_KEY) {
  setMaskingFunction(maskBraintrustValue);
  initLogger({
    projectName: env.BRAINTRUST_PROJECT_NAME ?? "hosted-agents",
    apiKey: env.BRAINTRUST_API_KEY,
  });

  observe((event, ctx) => {
    const compatible = compatibleEvent(event);

    if (compatible) {
      braintrustFlueObserver(compatible, ctx as BraintrustFlueContext);
    }
  });
}
