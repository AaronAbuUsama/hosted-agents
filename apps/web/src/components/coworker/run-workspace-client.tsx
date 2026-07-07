"use client";

import type { ReactElement } from "react";

import dynamic from "next/dynamic";

import type { RunWorkspaceDataIslandProps } from "./run-workspace-data-island";
import { RunWorkspaceLoading } from "./run-workspace-data-island";

const RunWorkspaceDataIsland = dynamic(() => import("./run-workspace-data-island"), {
  ssr: false,
  loading: RunWorkspaceLoading,
});

export default function RunWorkspaceClient(props: RunWorkspaceDataIslandProps): ReactElement {
  return <RunWorkspaceDataIsland {...props} />;
}
