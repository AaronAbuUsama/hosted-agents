import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";

import RunDetailClient from "@/components/coworker/run-detail-client";
import type { RunDetailTab } from "@/components/coworker/run-rollout";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

function parseRunDetailTab(value?: string): RunDetailTab {
  if (value === "timeline" || value === "github") {
    return value;
  }

  return "review";
}

export default async function RunDetailPage({
  params,
  searchParams,
}: RunDetailPageProps): Promise<ReactElement> {
  const [{ runId }, query] = await Promise.all([params, searchParams]);

  return (
    <CoworkerPage variant="workspace" width="full">
      <RunDetailClient runId={runId} initialTab={parseRunDetailTab(query.tab)} />
    </CoworkerPage>
  );
}
