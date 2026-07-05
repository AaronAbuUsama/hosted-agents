import { db } from "@hosted-agents/db";
import { reviewRun } from "@hosted-agents/db/schema/reviews";
import { defineWorkflow } from "@flue/runtime";
import { eq } from "drizzle-orm";
import * as v from "valibot";

import codeReviewAgent from "../agents/code-review";
import { registerOpenAICodexCredentialModel } from "../lib/provider-credential-model";

const severitySchema = v.picklist(["low", "medium", "high", "critical"]);

const findingSchema = v.object({
  title: v.string(),
  severity: severitySchema,
  file: v.optional(v.string()),
  line: v.optional(v.number()),
  detail: v.string(),
  recommendation: v.optional(v.string()),
});

const reviewResultSchema = v.object({
  summary: v.string(),
  findings: v.array(findingSchema),
});

export default defineWorkflow({
  agent: codeReviewAgent,
  input: v.object({
    reviewRunId: v.string(),
    repositoryUrl: v.optional(v.string()),
    repositoryOwner: v.optional(v.string()),
    repositoryName: v.optional(v.string()),
    branch: v.string(),
    baseBranch: v.optional(v.string()),
    reviewContext: v.optional(v.string()),
    providerCredentialId: v.optional(v.string()),
  }),
  output: reviewResultSchema,

  async run({ harness, input, log }) {
    const logContext = {
      reviewRunId: input.reviewRunId,
      repositoryOwner: input.repositoryOwner,
      repositoryName: input.repositoryName,
      branch: input.branch,
      baseBranch: input.baseBranch,
      hasRepositoryUrl: Boolean(input.repositoryUrl),
      hasReviewContext: Boolean(input.reviewContext),
      hasProviderCredential: Boolean(input.providerCredentialId),
    };

    log.info("Code review run accepted", logContext);

    await db
      .update(reviewRun)
      .set({
        status: "running",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, input.reviewRunId));

    try {
      const model = input.providerCredentialId
        ? await registerOpenAICodexCredentialModel(input.providerCredentialId)
        : undefined;

      log.info("Code review model ready", {
        ...logContext,
        model: model ? "openai-codex/gpt-5.5" : "agent default",
      });

      const session = await harness.session();
      const { data } = await session.prompt(
        [
          "Run a code review for this request.",
          "",
          `Repository URL: ${input.repositoryUrl || "not provided"}`,
          `Repository owner: ${input.repositoryOwner || "not provided"}`,
          `Repository name: ${input.repositoryName || "not provided"}`,
          `Branch: ${input.branch}`,
          `Base branch: ${input.baseBranch || "not provided"}`,
          "",
          "Review context:",
          input.reviewContext || "No diff or additional context was supplied.",
        ].join("\n"),
        {
          result: reviewResultSchema,
          model,
        },
      );

      log.info("Code review run completed", {
        ...logContext,
        findingCount: data.findings.length,
      });

      await db
        .update(reviewRun)
        .set({
          status: "completed",
          summary: data.summary,
          findingsJson: JSON.stringify(data.findings),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reviewRun.id, input.reviewRunId));

      return data;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Unknown review failure");

      log.error("Code review run failed", {
        ...logContext,
        error: failure,
        errorMessage: failure.message,
      });

      await db
        .update(reviewRun)
        .set({
          status: "failed",
          errorMessage: failure.message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reviewRun.id, input.reviewRunId));

      throw error;
    }
  },
});
