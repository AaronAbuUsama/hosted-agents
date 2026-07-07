"use client";

import { useState, type ReactElement } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useLiveQuery } from "@tanstack/react-db";

import {
  agentRunsCollection,
  createAgentRunArtifactsCollection,
  createAgentRunEventsCollection,
} from "@/lib/collections/agent-runs";
import {
  mapAgentRunEventToTimelineRow,
  mapAgentRunEventsToTranscriptRows,
  sortRunTimelineEvents,
  type RunViewModelRow,
} from "@/lib/run-view-model";

import RunWorkspace from "./run-workspace";

export type RunWorkspaceDataIslandProps = {
  runId: string;
};

export default function RunWorkspaceDataIsland({
  runId,
}: RunWorkspaceDataIslandProps): ReactElement {
  const { data: runs, isError, isLoading } = useLiveQuery(agentRunsCollection);

  if (isError) {
    return (
      <RunWorkspaceState
        title="Run could not load"
        description="The server did not return agent runs for this session. Check the local API and active organization session."
        tone="error"
      />
    );
  }

  if (isLoading && runs.length === 0) {
    return <RunWorkspaceLoading />;
  }

  const run = runs.find((candidate) => candidate.id === runId);
  if (!run) {
    return (
      <RunWorkspaceState
        title="Run not found"
        description="No agent_run record is visible for this organization and run id."
      />
    );
  }

  return <RunWorkspaceCollectionsIsland key={run.id} run={run} />;
}

function RunWorkspaceCollectionsIsland({ run }: { run: RunViewModelRow }): ReactElement {
  const [eventsCollection] = useState(() => createAgentRunEventsCollection(run.id));
  const [artifactsCollection] = useState(() => createAgentRunArtifactsCollection(run.id));
  const {
    data: events,
    isError: eventsError,
    isLoading: eventsLoading,
  } = useLiveQuery(eventsCollection);
  const {
    data: artifacts,
    isError: artifactsError,
    isLoading: artifactsLoading,
  } = useLiveQuery(artifactsCollection);

  return (
    <RunWorkspace
      run={run}
      events={sortRunTimelineEvents(events.map(mapAgentRunEventToTimelineRow))}
      transcriptRows={mapAgentRunEventsToTranscriptRows(events)}
      artifacts={artifacts}
      eventsState={getCollectionState(eventsError, eventsLoading, events.length)}
      artifactsState={getCollectionState(artifactsError, artifactsLoading, artifacts.length)}
    />
  );
}

function getCollectionState(
  isError: boolean,
  isLoading: boolean,
  itemCount: number,
): "error" | "loading" | "ready" {
  if (isError) {
    return "error";
  }

  if (isLoading && itemCount === 0) {
    return "loading";
  }

  return "ready";
}

export function RunWorkspaceLoading(): ReactElement {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" padding={4}>
          <Center>
            <Text type="supporting" color="secondary">
              Loading run workspace…
            </Text>
          </Center>
        </LayoutContent>
      }
    />
  );
}

function RunWorkspaceState({
  title,
  description,
  tone,
}: {
  title: string;
  description: string;
  tone?: "error";
}): ReactElement {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" padding={4}>
          {tone === "error" ? (
            <Banner status="error" title={title} description={description} container="section" />
          ) : (
            <EmptyState title={title} description={description} headingLevel={2} />
          )}
        </LayoutContent>
      }
    />
  );
}
