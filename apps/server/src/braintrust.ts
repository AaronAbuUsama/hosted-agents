import { instrument } from "@flue/runtime";
import { braintrustFlueInstrumentation, initLogger, setMaskingFunction } from "braintrust";

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /api[_-]?key|token|secret|password|authorization|credential|dsn|private[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret/i;
const SENSITIVE_STRING_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9_]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
];

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

setMaskingFunction(maskBraintrustValue);
initLogger({ projectName: "hosted-agents" });
instrument(braintrustFlueInstrumentation());
