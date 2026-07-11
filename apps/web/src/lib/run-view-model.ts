import { IMPLEMENTATION_WORKER_ROLE } from "@/lib/github-installations";

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
  // The issue a run worked. Implementation runs carry the issue they implement;
  // review runs carry the issue their PR closes, recovered server-side from the
  // Coder head branch (`coder/issue-<n>-<slug>`). Null when the run's PR is not a
  // Coder PR (a human PR has no issue linkage). The issue detail's Runs block
  // filters on this to show the runs that worked a given issue (QA-B4, issue #54).
  issueNumber: number | null;
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
  // Epoch ms for recency sorting (startedAt, else createdAt). The `started` field
  // above is a display string and is not reliably sortable; this is.
  orderTimestamp: number;
};

// A single linked run as the issue detail's Runs block renders it: one compact,
// clickable row per run that worked the issue. Deliberately does NOT carry the run
// timeline/transcript — per QA-B4 (issue #54) an issue links to its runs, it does
// not embed them. Kept beside RunViewModelRow so the mapping stays pure and
// unit-tested (no React), mirroring the Runs table's row model.
export type IssueRunRow = {
  id: string;
  href: string;
  // The worker role, humanized ("The Coder", "Code Review Worker") — which run
  // worked the issue, implementation vs review.
  roleLabel: string;
  status: RunViewModelStatus;
  started: string;
  duration: string;
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
    orderTimestamp: runOrderTimestamp(run),
  };
}

// The runs list is a flat audit log, newest first (runs are only ever read after
// the fact — no status grouping). Pure so the ordering is unit-tested; ties break
// on id for a stable order.
export function sortRunRowsByRecency(rows: readonly RunViewModelRow[]): RunViewModelRow[] {
  return [...rows].sort((left, right) => {
    const byRecency = right.orderTimestamp - left.orderTimestamp;
    return byRecency !== 0 ? byRecency : left.id.localeCompare(right.id);
  });
}

// A project's Runs tab must show only that project's runs. Runs are grouped in
// the view model by their "owner/name" repository label (see `repositoryLabel`),
// which is the same value a linked repository carries as its `fullName`. Scoping
// a project's runs is therefore an exact match on that group key, so one
// project's board never bleeds another project's runs (spec #19, story 27).
export function filterRunsByRepository(
  rows: RunViewModelRow[],
  repositoryFullName: string,
): RunViewModelRow[] {
  return rows.filter((row) => row.repo === repositoryFullName);
}

// The runs that worked one issue, as compact link rows for the issue detail's
// Runs block (QA-B4, issue #54). `agentRuns` is org-scoped, so we match on both
// the issue number AND the repository label — two repositories in the same org can
// each carry an issue #4, and `agent_run.issue_number` alone would conflate them.
// Rows are ordered oldest-first so the block reads as a timeline (implementation
// first, then the reviews it triggered), tie-broken by id for a stable order.
export function selectIssueRunRows(
  runs: readonly AgentRunApiRecord[],
  scope: { issueNumber: number; repositoryFullName: string },
): IssueRunRow[] {
  return runs
    .filter(
      (run) =>
        run.issueNumber === scope.issueNumber && repositoryLabel(run) === scope.repositoryFullName,
    )
    .sort((left, right) => {
      const byStart = runOrderTimestamp(left) - runOrderTimestamp(right);
      return byStart !== 0 ? byStart : left.id.localeCompare(right.id);
    })
    .map(mapAgentRunToIssueRunRow);
}

// How many runs worked each issue in one repository, for the board's "Runs"
// column. Same scoping as selectIssueRunRows (issue number AND repository label,
// since agentRuns is org-scoped and two repos can share an issue number), but
// aggregated into a number-keyed count map so the board resolves every lane's
// rows in one pass. Pure + unit-tested.
export function countRunsByIssue(
  runs: readonly AgentRunApiRecord[],
  repositoryFullName: string,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const run of runs) {
    if (run.issueNumber === null || repositoryLabel(run) !== repositoryFullName) {
      continue;
    }
    counts.set(run.issueNumber, (counts.get(run.issueNumber) ?? 0) + 1);
  }
  return counts;
}

function mapAgentRunToIssueRunRow(run: AgentRunApiRecord): IssueRunRow {
  const status = mapAgentRunStatus(run.status);
  return {
    id: run.id,
    href: `/app/runs/${run.id}`,
    roleLabel: nonEmpty(run.workerDisplayName) ?? humanizeToken(run.workerRole),
    status,
    started: formatDate(nonEmpty(run.startedAt) ?? run.createdAt),
    duration: formatDuration(run, status),
  };
}

function runOrderTimestamp(run: AgentRunApiRecord): number {
  return parseTimestamp(run.startedAt) ?? parseTimestamp(run.createdAt) ?? 0;
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

// A curated stage divider in the workspace transcript: a human-meaningful
// milestone ("Cloning repository", "Opened pull request") rendered as a
// ChatSystemMessage between chat turns. Derived from the durable event's own
// message/stage, never from Flue runtime chatter.
export type RunTranscriptFeedItem =
  | { kind: "divider"; key: string; label: string }
  | { kind: "row"; key: string; row: RunTranscriptRow };

// The durable events a person cares to see as timeline milestones. These are
// the `flue_event_type IS NULL` events (Coder-emitted lifecycle, ~2.1k rows)
// as opposed to the ~29k Flue runtime events that make up the chat turns. Keep
// this in lockstep with the events the worker emits at stage boundaries.
const TRANSCRIPT_DIVIDER_TYPES = new Set([
  "github.issue.kickoff_requested",
  "queue.created",
  "sandbox.created",
  "stage.repository_cloning",
  "stage.branch_creating",
  "github.tool.create_pull_request.completed",
  "github.tool.post_issue_progress_comment.completed",
  "result.completed",
  "result.failed",
]);

// Build the workspace transcript feed: chat turns (assistant/user/tool rows)
// interleaved with curated stage dividers, in sequence order. An event becomes
// EITHER a divider (a curated lifecycle event with no Flue type) OR its
// transcript rows (a Flue message_end) OR nothing (runtime noise). Pure so the
// workspace's feed composition is unit-tested without React.
export function selectRunTranscriptFeed(
  events: AgentRunEventApiRecord[],
): RunTranscriptFeedItem[] {
  const items: RunTranscriptFeedItem[] = [];

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const flueType = nonEmpty(event.flueEventType);
    if (!flueType && TRANSCRIPT_DIVIDER_TYPES.has(event.type)) {
      items.push({
        kind: "divider",
        key: `divider-${event.id}`,
        label: nonEmpty(event.message) ?? humanizeStage(nonEmpty(event.stage) ?? event.type),
      });
      continue;
    }

    for (const row of mapAgentRunEventToTranscriptRow(event)) {
      items.push({ kind: "row", key: row.id, row });
    }
  }

  return items;
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

// The verb reflects the run's role: the Reviewer reviews a pull request, the
// implementation ("Coder") run implements an issue. Keyed off workerRole so a new
// role's runs never mislabel themselves as reviews in the Runs tab.
function verbForRun(run: AgentRunApiRecord): string {
  return run.workerRole === IMPLEMENTATION_WORKER_ROLE ? "Implement" : "Review";
}

function titleForRun(run: AgentRunApiRecord): string {
  const verb = verbForRun(run);
  if (typeof run.pullRequestNumber === "number") {
    return `${verb} PR #${run.pullRequestNumber}`;
  }

  const repo = repositoryLabel(run);
  if (repo !== "Unknown repository") {
    return `${verb} ${repo}`;
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
