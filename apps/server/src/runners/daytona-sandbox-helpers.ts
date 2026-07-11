// Shared sandbox-command helpers for the Daytona runners (code review + the
// write-capable implementation runner). Both runners drive git and shell inside a
// Daytona sandbox the same way — quote arguments safely, scrub installation tokens
// out of logs, and fail loudly on a non-zero exit — so that logic lives here once
// rather than being copy-pasted per role. Kept structurally typed (SandboxCommandRunner)
// so tests can drive it with a fake sandbox and the real @daytona/sdk Sandbox
// satisfies it without an explicit import.

export type SandboxCommandResult = {
  result?: string;
  exitCode?: number;
  artifacts?: { stdout?: string } | null;
};

// The minimal shape both runners need from a sandbox to run a command. The real
// Daytona Sandbox's `process.executeCommand` matches this signature, so it is
// assignable here and a fake in a test can implement just this method.
export type SandboxCommandRunner = {
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ): Promise<SandboxCommandResult>;
  };
};

// Replace every occurrence of a secret with a redaction marker. Used to keep
// installation tokens out of the durable run logs even though a command line or
// its output may contain the token-embedded git remote.
export function sanitizeSecret(value: string, secret: string) {
  return secret ? value.replaceAll(secret, "[redacted]") : value;
}

// Single-quote a value for a POSIX shell, escaping embedded single quotes. Every
// dynamic value interpolated into a sandbox command goes through this so an
// attacker-controlled repo/branch/title cannot break out of the argument.
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Guard the one class of value that cannot be shell-quoted away — an owner or repo
// name that is interpolated into a URL, not just a shell argument. GitHub names are
// a restricted character set, so anything outside it is rejected before use.
export function assertGitHubName(value: string, label: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Unsafe GitHub ${label}: ${value}`);
  }
}

export function commandOutput(result: SandboxCommandResult) {
  return result.result || result.artifacts?.stdout || "";
}

// Run one command in the sandbox: redact secrets from both the echoed command and
// its captured output before pushing them to the logs, merge stderr into stdout so
// nothing is lost, and throw on a non-zero exit so a failed git step aborts the run
// with an auditable message rather than silently continuing.
export async function executeSandboxCommand({
  sandbox,
  command,
  cwd,
  env,
  timeout,
  logs,
  redactions,
}: {
  sandbox: SandboxCommandRunner;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  logs: string[];
  redactions: string[];
}) {
  const redactedCommand = redactions.reduce(
    (current, secret) => sanitizeSecret(current, secret),
    command,
  );
  logs.push(`$ ${redactedCommand}`);
  const result = await sandbox.process.executeCommand(`${command} 2>&1`, cwd, env, timeout);
  const output = redactions.reduce(
    (current, secret) => sanitizeSecret(current, secret),
    commandOutput(result),
  );

  if (output.trim()) {
    logs.push(output.trimEnd());
  }

  if ((result.exitCode ?? 0) !== 0) {
    throw new Error(`Sandbox command failed with exit code ${result.exitCode}: ${redactedCommand}`);
  }

  return output;
}
