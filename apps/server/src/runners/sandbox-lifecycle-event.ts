// The durable lifecycle events a sandbox runner emits back to the worker so the
// run's timeline is reconstructable. Shared by every worker role (code review,
// implementation) so there is one event vocabulary, not one per role. Kept in a
// dependency-free module so both the role-specific runner interfaces and the
// shared worker core can import it without an import cycle.
export type SandboxLifecycleEvent =
  | {
      type: "sandbox.created";
      sandboxProvider: string;
      sandboxId: string;
      labels: Record<string, string>;
    }
  | {
      type: "sandbox.deleted";
      sandboxId: string;
    }
  | {
      type: "sandbox.delete_failed";
      sandboxId: string;
      errorMessage: string;
    }
  | {
      type: "stage";
      stage: string;
      message: string;
      payload?: unknown;
    }
  | {
      type: "flue.event";
      event: unknown;
    }
  | {
      type: "github.tool";
      toolName: string;
      status: "started" | "completed" | "failed";
      message: string;
      payload?: unknown;
    }
  | {
      type: "github.artifact";
      name: string;
      contentType: string;
      content?: string;
      payload?: unknown;
    };
