/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  mapAgentRunEventToTimelineRow,
  mapAgentRunEventsToTranscriptRows,
  sortRunTimelineEvents,
  mapAgentRunToRunRow,
  type AgentRunApiRecord,
  type AgentRunEventApiRecord,
  type RunTimelineEventStatus,
  type RunViewModelRow,
} from "./run-view-model";

function agentRun(overrides: Partial<AgentRunApiRecord> = {}): AgentRunApiRecord {
  return {
    id: "agent-run-42",
    organizationId: "org-1",
    userId: "user-1",
    providerCredentialId: "credential-1",
    coworkerSlug: "code-review",
    workerRole: "code_review",
    workerDisplayName: "Code Review Worker",
    runType: "github.pull_request_review",
    sourceProvider: "github",
    sourceDeliveryId: "delivery-1",
    repositoryOwner: "octo-org",
    repositoryName: "widgets",
    repositoryUrl: "https://github.com/octo-org/widgets",
    branch: "feature/slice-1",
    baseBranch: "main",
    pullRequestNumber: 42,
    pullRequestBaseRef: "main",
    pullRequestBaseSha: "base-sha-123",
    pullRequestHeadRef: "feature/slice-1",
    pullRequestHeadSha: "head-sha-456",
    status: "running",
    model: null,
    flueRunId: "flue-run-1",
    sandboxProvider: "daytona",
    sandboxId: "sandbox-1",
    currentStage: "sandbox_created",
    lastHeartbeatAt: "2026-07-06T10:04:00.000Z",
    summary: null,
    findings: [],
    errorMessage: null,
    startedAt: "2026-07-06T10:03:05.000Z",
    completedAt: null,
    createdAt: "2026-07-06T10:00:00.000Z",
    updatedAt: "2026-07-06T10:04:00.000Z",
    ...overrides,
  };
}

function agentRunEvent(overrides: Partial<AgentRunEventApiRecord> = {}): AgentRunEventApiRecord {
  return {
    id: "agent-run-event-7",
    runId: "agent-run-42",
    sequence: 7,
    category: "worker",
    type: "worker.claimed",
    stage: "worker_claimed",
    message: "Worker claimed queued GitHub pull request code review run",
    payload: { workerRole: "code_review" },
    flueEventIndex: null,
    flueEventType: null,
    createdAt: "2026-07-06T10:04:05.000Z",
    ...overrides,
  };
}

describe("run view model mapper", () => {
  test("maps real GitHub agent run metadata into the Runs row fields", () => {
    const row = mapAgentRunToRunRow(
      agentRun({
        workerDisplayName: "Abu Bakr",
        repositoryOwner: "coworker",
        repositoryName: "web",
        branch: "feature/github-app-install",
        baseBranch: "develop",
        pullRequestNumber: 482,
        currentStage: "flue_review",
      }),
    );

    expect(row).toMatchObject({
      id: "agent-run-42",
      coworkerName: "Abu Bakr",
      repo: "coworker/web",
      branch: "feature/github-app-install",
      title: "Review PR #482",
      trigger: "feature/github-app-install → develop",
      result: "Flue review",
    });
  });

  test("maps backend lifecycle statuses to explicit UI statuses without fixture-only review states", () => {
    const cases: Array<{
      backendStatus: AgentRunApiRecord["status"];
      expectedStatus: RunViewModelRow["status"];
    }> = [
      { backendStatus: "queued", expectedStatus: "Queued" },
      { backendStatus: "running", expectedStatus: "Running" },
      { backendStatus: "completed", expectedStatus: "Completed" },
      { backendStatus: "failed", expectedStatus: "Failed" },
    ];

    const statuses = cases.map(
      ({ backendStatus }) => mapAgentRunToRunRow(agentRun({ status: backendStatus })).status,
    );

    expect(statuses).toEqual(cases.map(({ expectedStatus }) => expectedStatus));
    expect(statuses).not.toContain("Needs review");
    expect(statuses).not.toContain("Blocked");
  });

  test("chooses result text from API summary, error message, then current stage", () => {
    const cases: Array<{
      input: Partial<AgentRunApiRecord>;
      expectedResult: string;
    }> = [
      {
        input: {
          status: "completed",
          summary: "Review completed with two high-confidence findings.",
          errorMessage: null,
          currentStage: "completed",
        },
        expectedResult: "Review completed with two high-confidence findings.",
      },
      {
        input: {
          status: "failed",
          summary: "This stale summary must not hide the failure.",
          errorMessage: "sandbox unavailable",
          currentStage: "failed",
        },
        expectedResult: "sandbox unavailable",
      },
      {
        input: {
          status: "running",
          summary: null,
          errorMessage: null,
          currentStage: "github_tool_submit_pull_request_review_started",
        },
        expectedResult: "GitHub tool submit pull request review started",
      },
      {
        input: {
          status: "queued",
          summary: null,
          errorMessage: null,
          currentStage: "queued",
        },
        expectedResult: "Queued",
      },
    ];

    expect(cases.map(({ input }) => mapAgentRunToRunRow(agentRun(input)).result)).toEqual(
      cases.map(({ expectedResult }) => expectedResult),
    );
  });

  test("formats started and duration labels from API timestamps without relative clock text", () => {
    const completed = mapAgentRunToRunRow(
      agentRun({
        status: "completed",
        createdAt: "2026-07-06T10:00:00.000Z",
        startedAt: "2026-07-06T10:03:05.000Z",
        completedAt: "2026-07-06T10:08:07.000Z",
        summary: "Finished review.",
        currentStage: "completed",
      }),
    );

    expect(completed.started).toBe("Jul 6, 2026, 10:03 UTC");
    expect(completed.duration).toBe("05:02");

    const queued = mapAgentRunToRunRow(
      agentRun({
        status: "queued",
        createdAt: "2026-07-06T10:00:00.000Z",
        startedAt: null,
        completedAt: null,
        currentStage: "queued",
      }),
    );

    expect(queued.started).toBe("Jul 6, 2026, 10:00 UTC");
    expect(queued.duration).toBe("Queued");
  });
});

describe("run detail event timeline mapper", () => {
  test("maps ordered event metadata into a timeline display row", () => {
    const row = mapAgentRunEventToTimelineRow(
      agentRunEvent({
        sequence: 12,
        category: "worker",
        type: "worker.installation_token",
        stage: "installation_token",
        message: "Creating GitHub installation access token",
        createdAt: "2026-07-06T10:04:05.000Z",
      }),
    );

    expect(row).toMatchObject({
      id: "agent-run-event-7",
      runId: "agent-run-42",
      sequenceLabel: "#12",
      categoryLabel: "Worker",
      stageLabel: "Installation token",
      message: "Creating GitHub installation access token",
      timestamp: "Jul 6, 2026, 10:04 UTC",
      status: "accent",
    });
  });

  test("orders timeline events by durable sequence before display", () => {
    const timelineEvents = [
      mapAgentRunEventToTimelineRow(agentRunEvent({ id: "agent-run-event-30", sequence: 30 })),
      mapAgentRunEventToTimelineRow(agentRunEvent({ id: "agent-run-event-10", sequence: 10 })),
      mapAgentRunEventToTimelineRow(agentRunEvent({ id: "agent-run-event-20", sequence: 20 })),
    ];

    expect(sortRunTimelineEvents(timelineEvents).map((event) => event.sequenceLabel)).toEqual([
      "#10",
      "#20",
      "#30",
    ]);
  });

  test("uses a humanized stage or type when the API event message is missing", () => {
    const fallbackMessages = [
      mapAgentRunEventToTimelineRow(
        agentRunEvent({
          type: "github.tool.create_pull_request_review.started",
          stage: "github_tool",
          message: "",
        }),
      ).message,
      mapAgentRunEventToTimelineRow(
        agentRunEvent({
          type: "worker.repository_lookup",
          stage: null,
          message: "   ",
        }),
      ).message,
    ];

    expect(fallbackMessages).toEqual(["GitHub tool", "Worker repository lookup"]);
    expect(fallbackMessages).not.toContain("");
    expect(fallbackMessages).not.toContain("Loaded pull request diff");
  });

  test("maps result events to terminal statuses and active categories to non-error statuses", () => {
    const cases: Array<{
      category: AgentRunEventApiRecord["category"];
      type: AgentRunEventApiRecord["type"];
      expectedStatus: RunTimelineEventStatus;
    }> = [
      {
        category: "result",
        type: "result.completed",
        expectedStatus: "success",
      },
      {
        category: "result",
        type: "result.failed",
        expectedStatus: "error",
      },
      { category: "queue", type: "queue.created", expectedStatus: "neutral" },
      {
        category: "worker",
        type: "worker.claimed",
        expectedStatus: "accent",
      },
      {
        category: "flue",
        type: "flue.operation_start",
        expectedStatus: "accent",
      },
      { category: "model", type: "flue.turn_start", expectedStatus: "accent" },
      {
        category: "tool",
        type: "github.tool.create_pull_request_review.started",
        expectedStatus: "warning",
      },
    ];

    const statuses = cases.map(
      ({ category, type }) =>
        mapAgentRunEventToTimelineRow(agentRunEvent({ category, type })).status,
    );

    expect(statuses).toEqual(cases.map(({ expectedStatus }) => expectedStatus));
    expect(statuses.slice(2)).not.toContain("error");
  });
});

describe("run transcript event mapper", () => {
  test("maps Flue user message_end text into a user transcript row", () => {
    const rows = mapAgentRunEventsToTranscriptRows([
      agentRunEvent({
        id: "event-user-message",
        sequence: 20,
        category: "model",
        type: "flue.message_end",
        message: "Flue event: message_end",
        payload: {
          type: "message_end",
          eventIndex: 3,
          message: {
            role: "user",
            content: "Please review the pull request for auth regressions.",
          },
        },
        flueEventIndex: 3,
        flueEventType: "message_end",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "event-user-message",
      runId: "agent-run-42",
      sequence: 20,
      role: "user",
      content: "Please review the pull request for auth regressions.",
    });
  });

  test("maps assistant toolCall content into an assistant row with the requested tool call", () => {
    const [row] = mapAgentRunEventsToTranscriptRows([
      agentRunEvent({
        id: "event-assistant-tool-call",
        sequence: 30,
        category: "model",
        type: "flue.message_end",
        message: "Flue event: message_end",
        payload: {
          type: "message_end",
          eventIndex: 4,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I will inspect the changed files first." },
              {
                type: "toolCall",
                toolCallId: "call-shell-1",
                toolName: "shell",
                args: { command: "bun test apps/web/src/lib/run-view-model.test.ts" },
              },
            ],
          },
        },
        flueEventIndex: 4,
        flueEventType: "message_end",
      }),
    ]);

    expect(row).toMatchObject({
      id: "event-assistant-tool-call",
      runId: "agent-run-42",
      sequence: 30,
      role: "assistant",
      content: "I will inspect the changed files first.",
      toolCalls: [
        {
          id: "call-shell-1",
          name: "shell",
          input: { command: "bun test apps/web/src/lib/run-view-model.test.ts" },
        },
      ],
    });
  });

  test("maps toolResult message_end details into a readable tool result row", () => {
    const [row] = mapAgentRunEventsToTranscriptRows([
      agentRunEvent({
        id: "event-tool-result",
        sequence: 40,
        category: "tool",
        type: "flue.message_end",
        message: "Flue event: message_end",
        payload: {
          type: "message_end",
          eventIndex: 5,
          message: {
            role: "toolResult",
            content: [
              {
                type: "toolResult",
                toolCallId: "call-shell-1",
                toolName: "shell",
                details: {
                  exitCode: 1,
                  output:
                    "error: Export named 'mapAgentRunEventsToTranscriptRows' not found in module",
                },
              },
            ],
          },
        },
        flueEventIndex: 5,
        flueEventType: "message_end",
      }),
    ]);

    expect(row).toMatchObject({
      id: "event-tool-result",
      runId: "agent-run-42",
      sequence: 40,
      role: "tool",
      toolCallId: "call-shell-1",
      toolName: "shell",
    });
    expect(row.content).toContain('"exitCode": 1');
    expect(row.content).toContain("mapAgentRunEventsToTranscriptRows");
  });

  test("ignores durable non-message timeline events when building transcript rows", () => {
    const rows = mapAgentRunEventsToTranscriptRows([
      agentRunEvent({
        id: "event-operation-start",
        sequence: 10,
        category: "flue",
        type: "flue.operation_start",
        message: "operation_start: review",
        payload: { type: "operation_start", eventIndex: 1, operationKind: "review" },
        flueEventIndex: 1,
        flueEventType: "operation_start",
      }),
      agentRunEvent({
        id: "event-user-message",
        sequence: 20,
        category: "model",
        type: "flue.message_end",
        message: "Flue event: message_end",
        payload: {
          type: "message_end",
          eventIndex: 2,
          message: { role: "user", content: "Only this message belongs in transcript." },
        },
        flueEventIndex: 2,
        flueEventType: "message_end",
      }),
      agentRunEvent({
        id: "event-worker-claimed",
        sequence: 30,
        category: "worker",
        type: "worker.claimed",
        stage: "worker_claimed",
        message: "Worker claimed queued GitHub pull request code review run",
        payload: { workerRole: "code_review" },
        flueEventIndex: null,
        flueEventType: null,
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["event-user-message"]);
  });

  test("orders transcript rows by durable event sequence instead of input order", () => {
    const rows = mapAgentRunEventsToTranscriptRows([
      agentRunEvent({
        id: "event-third",
        sequence: 30,
        category: "model",
        type: "flue.message_end",
        payload: {
          type: "message_end",
          eventIndex: 3,
          message: { role: "assistant", content: "Third response." },
        },
        flueEventIndex: 3,
        flueEventType: "message_end",
      }),
      agentRunEvent({
        id: "event-first",
        sequence: 10,
        category: "model",
        type: "flue.message_end",
        payload: {
          type: "message_end",
          eventIndex: 1,
          message: { role: "user", content: "First request." },
        },
        flueEventIndex: 1,
        flueEventType: "message_end",
      }),
      agentRunEvent({
        id: "event-second",
        sequence: 20,
        category: "model",
        type: "flue.message_end",
        payload: {
          type: "message_end",
          eventIndex: 2,
          message: { role: "assistant", content: "Second response." },
        },
        flueEventIndex: 2,
        flueEventType: "message_end",
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["event-first", "event-second", "event-third"]);
    expect(rows.map((row) => row.sequence)).toEqual([10, 20, 30]);
  });
});
