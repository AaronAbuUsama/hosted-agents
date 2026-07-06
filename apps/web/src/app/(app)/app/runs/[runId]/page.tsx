import type { ReactElement } from "react";

import { notFound } from "next/navigation";
import CoworkerPage from "@/components/coworker/coworker-page";

import RunRollout from "@/components/coworker/run-rollout";
import { coworkers, runs } from "@/lib/coworker-data";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunDetailPage({ params }: RunDetailPageProps): Promise<ReactElement> {
  const { runId } = await params;
  const run = runs.find((item) => item.id === runId);

  if (!run) {
    notFound();
  }

  const coworker = coworkers.find((item) => item.id === run.coworkerId);

  return (
    <CoworkerPage variant="workspace" width="full">
      <RunRollout coworker={coworker} run={run} />
    </CoworkerPage>
  );
}
