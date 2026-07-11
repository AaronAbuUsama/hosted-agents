import {
  ImplementationSandboxRunError,
  type ImplementationSandboxRunResult,
  type ImplementationSandboxRunner,
} from "./implementation-sandbox-runner";

// Placeholder for the write-capable Daytona runner. coder-mvp C3 lands the role
// adapter + serial worker; the actual sandbox flow (full checkout → `git switch
// -c coder/issue-<n>-<slug>` → Flue agent with write + issue tools → commit →
// push with the Coder token scrubbed from the remote → pulls.create → progress
// comment) is C5. Until then, a claimed implementation run fails fast with a
// clear, terminal reason rather than hanging, so the failure is auditable in the
// Runs tab.
export class DaytonaImplementationSandboxRunner implements ImplementationSandboxRunner {
  async run(): Promise<ImplementationSandboxRunResult> {
    throw new ImplementationSandboxRunError(
      "Implementation sandbox runner is not yet wired (coder-mvp C5: write runner).",
    );
  }
}
