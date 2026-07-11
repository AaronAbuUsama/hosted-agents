"use client";

import type { ReactElement } from "react";

import dynamic from "next/dynamic";

import { RunDetailLoading, type RunDetailDataIslandProps } from "./run-detail-data-island";

const RunDetailDataIsland = dynamic(() => import("./run-detail-data-island"), {
  ssr: false,
  loading: RunDetailLoading,
});

export default function RunDetailClient(props: RunDetailDataIslandProps): ReactElement {
  return <RunDetailDataIsland {...props} />;
}
