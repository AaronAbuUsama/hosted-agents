import type { ReactElement } from "react";

import { notFound } from "next/navigation";
import CoworkerPage from "@/components/coworker/coworker-page";

import RunRollout, { type RunDetailTab } from "@/components/coworker/run-rollout";
import { coworkers, runs } from "@/lib/coworker-data";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

const runDetailTabs = new Set<RunDetailTab>(["timeline", "transcript", "artifacts", "github"]);

function parseRunDetailTab(value?: string): RunDetailTab {
  return runDetailTabs.has(value as RunDetailTab) ? (value as RunDetailTab) : "timeline";
}

export default async function RunDetailPage({
  params,
  searchParams,
}: RunDetailPageProps): Promise<ReactElement> {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const run = runs.find((item) => item.id === runId);

  if (!run) {
    notFound();
  }

  const coworker = coworkers.find((item) => item.id === run.coworkerId);

  return (
    <CoworkerPage variant="workspace" width="full">
      <RunRollout coworker={coworker} initialTab={parseRunDetailTab(query.tab)} run={run} />
    </CoworkerPage>
  );
}
