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

export function mapAgentRunStatus(status: AgentRunApiStatus): RunViewModelStatus {
  return statusLabels[status] ?? "Unknown";
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
