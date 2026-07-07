export type AgentRunApiStatus = "queued" | "running" | "completed" | "failed" | (string & {});

export type AgentRunApiRecord = {
  id: string;
  organizationId: string;
  userId: string;
  providerCredentialId: string | null;
  coworkerSlug: string;
  workerRole: string;
  workerDisplayName: string;
  runType: string;
  sourceProvider: string;
  sourceDeliveryId: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  repositoryUrl: string | null;
  branch: string | null;
  baseBranch: string | null;
  pullRequestNumber: number | null;
  pullRequestBaseRef: string | null;
  pullRequestBaseSha: string | null;
  pullRequestHeadRef: string | null;
  pullRequestHeadSha: string | null;
  status: AgentRunApiStatus;
  flueRunId: string | null;
  sandboxProvider: string | null;
  sandboxId: string | null;
  currentStage: string | null;
  lastHeartbeatAt: string | null;
  summary: string | null;
  findings: unknown[];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunEventApiRecord = {
  id: string;
  runId: string;
  sequence: number;
  category: string;
  type: string;
  stage: string | null;
  message: string | null;
  payload: unknown;
  flueEventIndex: number | null;
  flueEventType: string | null;
  createdAt: string;
};

export type AgentRunArtifactApiRecord = {
  id: string;
  runId: string;
  name: string;
  contentType: string;
  content: string | null;
  payload: unknown;
  createdAt: string;
};

export type RunArtifactKind = "markdown" | "json" | "log" | "text";

export type RunArtifactViewRow = {
  id: string;
  runId: string;
  name: string;
  label: string;
  contentType: string;
  content: string;
  payload: unknown;
  createdAt: string;
  timestamp: string;
  kind: RunArtifactKind;
  language: string;
  sizeLabel: string;
};

export type RunTimelineEventStatus = "neutral" | "accent" | "warning" | "success" | "error";

export type RunTimelineEventRow = {
  id: string;
  runId: string;
  sequence: number;
  sequenceLabel: string;
  categoryLabel: string;
  stageLabel: string;
  typeLabel: string;
  message: string;
  timestamp: string;
  status: RunTimelineEventStatus;
};

export type RunTranscriptRole = "user" | "assistant" | "tool";

export type RunTranscriptToolCallRow = {
  id: string;
  name: string;
  input: unknown;
};

export type RunTranscriptRow = {
  id: string;
  runId: string;
  sequence: number;
  role: RunTranscriptRole;
  content: string;
  timestamp: string;
  thinking: string | null;
  toolCalls: RunTranscriptToolCallRow[];
  toolCallId: string | null;
  toolName: string | null;
  isError: boolean;
  model: string | null;
};

export type RunViewModelStatus = "Queued" | "Running" | "Completed" | "Failed" | "Unknown";

export type RunViewModelRow = {
  id: string;
  title: string;
  coworkerName: string;
  status: RunViewModelStatus;
  repo: string;
  branch: string;
  trigger: string;
  started: string;
  duration: string;
  result: string;
  sourceProvider: string;
  runType: string;
  currentStage: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

const statusLabels: Record<string, RunViewModelStatus> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function mapAgentRunToRunRow(run: AgentRunApiRecord): RunViewModelRow {
  const status = mapAgentRunStatus(run.status);
  const branch = nonEmpty(run.branch) ?? nonEmpty(run.pullRequestHeadRef) ?? "No branch";
  const baseBranch = nonEmpty(run.baseBranch) ?? nonEmpty(run.pullRequestBaseRef);

  return {
    id: run.id,
    title: titleForRun(run),
    coworkerName: nonEmpty(run.workerDisplayName) ?? humanizeToken(run.workerRole),
    status,
    repo: repositoryLabel(run),
    branch,
    trigger: baseBranch ? `${branch} → ${baseBranch}` : humanizeToken(run.runType),
    started: formatDate(nonEmpty(run.startedAt) ?? run.createdAt),
    duration: formatDuration(run, status),
    result: resultForRun(run),
    sourceProvider: run.sourceProvider,
    runType: run.runType,
    currentStage: run.currentStage,
  };
}

export function mapAgentRunArtifactToArtifactRow(
  artifact: AgentRunArtifactApiRecord,
): RunArtifactViewRow {
  const content = artifact.content ?? formatPayload(artifact.payload);
  const kind = artifactKind(artifact.name, artifact.contentType);

  return {
    id: artifact.id,
    runId: artifact.runId,
    name: artifact.name,
    label: artifactLabel(artifact.name),
    contentType: artifact.contentType,
    content,
    payload: artifact.payload,
    createdAt: artifact.createdAt,
    timestamp: formatDate(artifact.createdAt),
    kind,
    language: artifactLanguage(kind),
    sizeLabel: formatCharacterCount(content.length),
  };
}

export function mapAgentRunStatus(status: AgentRunApiStatus): RunViewModelStatus {
  return statusLabels[status] ?? "Unknown";
}

export function mapAgentRunEventToTimelineRow(event: AgentRunEventApiRecord): RunTimelineEventRow {
  const fallbackLabel = humanizeStage(nonEmpty(event.stage) ?? event.type);

  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    sequenceLabel: `#${event.sequence}`,
    categoryLabel: humanizeStage(event.category),
    stageLabel: fallbackLabel,
    typeLabel: humanizeStage(event.type),
    message: nonEmpty(event.message) ?? fallbackLabel,
    timestamp: formatDate(event.createdAt),
    status: timelineStatusForEvent(event),
  };
}

export function sortRunTimelineEvents(events: RunTimelineEventRow[]): RunTimelineEventRow[] {
  return [...events].sort((left, right) => left.sequence - right.sequence);
}

export function mapAgentRunEventsToTranscriptRows(
  events: AgentRunEventApiRecord[],
): RunTranscriptRow[] {
  return [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap(mapAgentRunEventToTranscriptRow);
}

function mapAgentRunEventToTranscriptRow(event: AgentRunEventApiRecord): RunTranscriptRow[] {
  const payload = asRecord(event.payload);
  if (payload.type !== "message_end" && event.flueEventType !== "message_end") {
    return [];
  }

  const message = asRecord(payload.message);
  const role = transcriptRole(message.role);
  if (!role) {
    return [];
  }

  if (role === "tool") {
    return [mapToolResultTranscriptRow(event, message)];
  }

  const contentParts = normalizeContentParts(message.content);
  const content = textFromContentParts(contentParts);
  const thinking = thinkingFromContentParts(contentParts);
  const toolCalls = toolCallsFromContentParts(contentParts);

  if (!content && !thinking && toolCalls.length === 0) {
    return [];
  }

  return [
    {
      id: event.id,
      runId: event.runId,
      sequence: event.sequence,
      role,
      content,
      timestamp: formatDate(event.createdAt),
      thinking,
      toolCalls,
      toolCallId: null,
      toolName: null,
      isError: Boolean(message.isError),
      model: stringValue(message.model),
    },
  ];
}

function mapToolResultTranscriptRow(
  event: AgentRunEventApiRecord,
  message: Record<string, unknown>,
): RunTranscriptRow {
  const contentParts = normalizeContentParts(message.content);
  const resultPart = contentParts.find((part) => asRecord(part).type === "toolResult");
  const resultRecord = asRecord(resultPart);
  const details = resultRecord.details ?? asRecord(message.details).output ?? message.details;
  const textContent = textFromContentParts(contentParts);
  const content = details === undefined ? textContent : formatPayload(details);

  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    role: "tool",
    content,
    timestamp: formatDate(event.createdAt),
    thinking: null,
    toolCalls: [],
    toolCallId: stringValue(message.toolCallId) ?? stringValue(resultRecord.toolCallId),
    toolName: stringValue(message.toolName) ?? stringValue(resultRecord.toolName),
    isError: Boolean(message.isError),
    model: null,
  };
}

function timelineStatusForEvent(event: AgentRunEventApiRecord): RunTimelineEventStatus {
  if (event.category === "result") {
    if (event.type === "result.completed") {
      return "success";
    }

    if (event.type === "result.failed") {
      return "error";
    }

    return "neutral";
  }

  if (event.category === "tool") {
    return "warning";
  }

  if (event.category === "queue" || event.category === "github") {
    return "neutral";
  }

  return "accent";
}

function titleForRun(run: AgentRunApiRecord): string {
  if (typeof run.pullRequestNumber === "number") {
    return `Review PR #${run.pullRequestNumber}`;
  }

  const repo = repositoryLabel(run);
  if (repo !== "Unknown repository") {
    return `Review ${repo}`;
  }

  return `Run ${run.id.slice(0, 8)}`;
}

function repositoryLabel(run: AgentRunApiRecord): string {
  const owner = nonEmpty(run.repositoryOwner);
  const name = nonEmpty(run.repositoryName);

  if (owner && name) {
    return `${owner}/${name}`;
  }

  if (name) {
    return name;
  }

  const parsedUrl = parseRepositoryUrl(run.repositoryUrl);
  return parsedUrl ?? "Unknown repository";
}

function parseRepositoryUrl(repositoryUrl: string | null): string | null {
  const value = nonEmpty(repositoryUrl);
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const [owner, name] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (owner && name) {
      return `${owner}/${name.replace(/\.git$/, "")}`;
    }
  } catch {
    return null;
  }

  return null;
}

function resultForRun(run: AgentRunApiRecord): string {
  if (run.status === "failed") {
    return nonEmpty(run.errorMessage) ?? "Failed";
  }

  if (run.status === "completed") {
    return nonEmpty(run.summary) ?? "Completed";
  }

  return humanizeStage(nonEmpty(run.currentStage) ?? run.status);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

function formatDuration(run: AgentRunApiRecord, status: RunViewModelStatus): string {
  if (status === "Queued" && !run.startedAt) {
    return "Queued";
  }

  if (status === "Running" && !run.completedAt) {
    return "Running";
  }

  const start = parseTimestamp(run.startedAt ?? run.createdAt);
  const end = parseTimestamp(run.completedAt);
  if (start === null || end === null || end < start) {
    return status;
  }

  return formatElapsed(end - start);
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }

  return `${pad2(minutes)}:${pad2(seconds)}`;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function transcriptRole(value: unknown): RunTranscriptRole | null {
  if (value === "user" || value === "assistant") {
    return value;
  }

  if (value === "toolResult" || value === "tool") {
    return "tool";
  }

  return null;
}

function normalizeContentParts(content: unknown): unknown[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return Array.isArray(content) ? content : [];
}

function textFromContentParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      const record = asRecord(part);
      if (record.type === "text") {
        return stringValue(record.text);
      }
      return null;
    })
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

function thinkingFromContentParts(parts: unknown[]): string | null {
  const thinking = parts
    .map((part) => {
      const record = asRecord(part);
      if (record.type === "thinking" || record.type === "reasoning") {
        return stringValue(record.thinking) ?? stringValue(record.text);
      }
      return null;
    })
    .filter((text): text is string => Boolean(text))
    .join("\n\n");

  return thinking || null;
}

function toolCallsFromContentParts(parts: unknown[]): RunTranscriptToolCallRow[] {
  return parts.flatMap((part, index) => {
    const record = asRecord(part);
    if (record.type !== "toolCall") {
      return [];
    }

    return [
      {
        id: stringValue(record.id) ?? stringValue(record.toolCallId) ?? `tool-call-${index}`,
        name: stringValue(record.name) ?? stringValue(record.toolName) ?? "tool",
        input: record.arguments ?? record.args ?? {},
      },
    ];
  });
}

function artifactLabel(name: string): string {
  const finalSegment = name.split("/").pop() ?? name;
  return finalSegment || name;
}

function artifactKind(name: string, contentType: string): RunArtifactKind {
  if (contentType.includes("json") || name.endsWith(".json")) {
    return "json";
  }

  if (contentType.includes("markdown") || name.endsWith(".md")) {
    return "markdown";
  }

  if (contentType.startsWith("text/") || name.endsWith(".log")) {
    return name.endsWith(".log") ? "log" : "text";
  }

  return "text";
}

function artifactLanguage(kind: RunArtifactKind): string {
  if (kind === "json") {
    return "json";
  }

  if (kind === "markdown") {
    return "markdown";
  }

  return "text";
}

function formatCharacterCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M chars`;
  }

  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K chars`;
  }

  return `${count} chars`;
}

function formatPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function humanizeToken(value: string): string {
  const words = tokenWords(value);

  if (words.length === 0) {
    return "Unknown";
  }

  return words
    .map((word, index) => {
      if (word.toUpperCase() === "PR") {
        return "PR";
      }

      if (word.toLowerCase() === "github") {
        return "GitHub";
      }

      if (index > 0 && ["a", "an", "and", "for", "in", "of", "the", "to"].includes(word)) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function humanizeStage(value: string): string {
  const words = tokenWords(value);

  if (words.length === 0) {
    return "Unknown";
  }

  return words
    .map((word, index) => {
      if (word.toLowerCase() === "github") {
        return "GitHub";
      }

      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      return word;
    })
    .join(" ");
}

function tokenWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\-\s]+/)
    .filter(Boolean);
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
