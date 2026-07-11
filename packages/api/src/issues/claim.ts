import { and, eq, isNull } from "drizzle-orm";

import type { db as productionDb } from "@hosted-agents/db";
import { githubIssue } from "@hosted-agents/db/schema/issues";

// The claim half of the issues deep module (see issue #19, spec #21 stories 3–4).
// Kick-off delegates here to reserve a synced issue for a worker role before it
// queues a run. The claim is the concurrency primitive: exactly one caller wins,
// so a double kick-off yields a single claim and a single run, and the board's
// Executing lane is driven by the claim (not the label).

// A drizzle handle scoped to what the claim needs — the production db and a
// transaction both satisfy it, so the claim can run inside kick-off's transaction
// alongside the run insert (they must commit together to stay atomic).
type ClaimDatabase = Pick<typeof productionDb, "update" | "select">;

export type IssueClaim = {
  workerRole: string;
  runId: string;
  claimedAt: Date;
};

// `claimed` — this caller won the reservation, so it (and only it) should queue a
// run. `already_claimed` — another kick-off got there first; the caller returns the
// existing claim as an idempotent no-op and queues nothing.
export type ClaimIssueResult =
  | { outcome: "claimed"; claim: IssueClaim }
  | { outcome: "already_claimed"; claim: IssueClaim };

// Atomically claim a synced issue for a worker role. The conditional UPDATE only
// matches an unclaimed row (`claimed_by_run_id IS NULL`), so concurrent or repeated
// callers cannot both win: the first stamps the claim, and every later caller reads
// the existing claim back and returns `already_claimed`. The issue row must already
// be synced (kick-off upserts it from the live issue first); an unsynced issue has
// nothing to claim and is a programming error here.
export async function claimIssueForWorker(
  database: ClaimDatabase,
  params: {
    githubRepositoryId: string;
    issueNumber: number;
    workerRole: string;
    runId: string;
  },
): Promise<ClaimIssueResult> {
  const claimedAt = new Date();

  const won = await database
    .update(githubIssue)
    .set({
      claimedByWorkerRole: params.workerRole,
      claimedByRunId: params.runId,
      claimedAt,
    })
    .where(
      and(
        eq(githubIssue.githubRepositoryId, params.githubRepositoryId),
        eq(githubIssue.number, params.issueNumber),
        isNull(githubIssue.claimedByRunId),
      ),
    )
    .returning({ runId: githubIssue.claimedByRunId });

  if (won.length > 0 && won[0]?.runId === params.runId) {
    return {
      outcome: "claimed",
      claim: { workerRole: params.workerRole, runId: params.runId, claimedAt },
    };
  }

  // Lost the race (or already claimed by an earlier kick-off) — read the existing
  // claim so the caller can report the run that owns the issue.
  const [existing] = await database
    .select({
      workerRole: githubIssue.claimedByWorkerRole,
      runId: githubIssue.claimedByRunId,
      claimedAt: githubIssue.claimedAt,
    })
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.githubRepositoryId, params.githubRepositoryId),
        eq(githubIssue.number, params.issueNumber),
      ),
    )
    .limit(1);

  if (!existing?.runId || !existing.workerRole) {
    throw new Error(
      `Issue #${params.issueNumber} is not synced or lost its claim; cannot claim for ${params.workerRole}.`,
    );
  }

  return {
    outcome: "already_claimed",
    claim: {
      workerRole: existing.workerRole,
      runId: existing.runId,
      claimedAt: existing.claimedAt ?? claimedAt,
    },
  };
}
