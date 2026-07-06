/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  mapAgentRunToRunRow,
  type AgentRunApiRecord,
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
      name: string;
      backendStatus: AgentRunApiRecord["status"];
      expectedStatus: RunViewModelRow["status"];
    }> = [
      { name: "queued", backendStatus: "queued", expectedStatus: "Queued" },
      { name: "running", backendStatus: "running", expectedStatus: "Running" },
      { name: "completed", backendStatus: "completed", expectedStatus: "Completed" },
      { name: "failed", backendStatus: "failed", expectedStatus: "Failed" },
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
      name: string;
      input: Partial<AgentRunApiRecord>;
      expectedResult: string;
    }> = [
      {
        name: "completed summary",
        input: {
          status: "completed",
          summary: "Review completed with two high-confidence findings.",
          errorMessage: null,
          currentStage: "completed",
        },
        expectedResult: "Review completed with two high-confidence findings.",
      },
      {
        name: "failed error message",
        input: {
          status: "failed",
          summary: "This stale summary must not hide the failure.",
          errorMessage: "sandbox unavailable",
          currentStage: "failed",
        },
        expectedResult: "sandbox unavailable",
      },
      {
        name: "running current stage",
        input: {
          status: "running",
          summary: null,
          errorMessage: null,
          currentStage: "github_tool_submit_pull_request_review_started",
        },
        expectedResult: "GitHub tool submit pull request review started",
      },
      {
        name: "queued current stage",
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
