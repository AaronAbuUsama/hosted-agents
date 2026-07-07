import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import RunWorkspaceClient from "@/components/coworker/run-workspace-client";

type RunWorkspacePageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunWorkspacePage({
  params,
}: RunWorkspacePageProps): Promise<ReactElement> {
  const { runId } = await params;

  return (
    <CoworkerPage variant="workspace" width="full">
      <RunWorkspaceClient runId={runId} />
    </CoworkerPage>
  );
}
