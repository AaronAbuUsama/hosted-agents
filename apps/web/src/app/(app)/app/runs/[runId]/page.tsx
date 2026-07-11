import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";

import RunDetailClient from "@/components/coworker/run-detail-client";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
  // `?tab=` is still parsed so legacy timeline/transcript/github deep links
  // resolve, but the workspace is a single surface now — the value is ignored.
  searchParams: Promise<{ tab?: string }>;
};

export default async function RunDetailPage({
  params,
}: RunDetailPageProps): Promise<ReactElement> {
  const { runId } = await params;

  return (
    <CoworkerPage variant="workspace" width="full">
      <RunDetailClient runId={runId} />
    </CoworkerPage>
  );
}
