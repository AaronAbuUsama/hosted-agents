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
import { selectRunTranscriptFeed, type RunViewModelRow } from "@/lib/run-view-model";

import RunRollout from "./run-rollout";

export type RunDetailDataIslandProps = {
  runId: string;
};

export default function RunDetailDataIsland({ runId }: RunDetailDataIslandProps): ReactElement {
  const { data: runs, isError, isLoading } = useLiveQuery(agentRunsCollection);

  if (isError) {
    return (
      <RunDetailState
        title="Run could not load"
        description="The server did not return agent runs for this session. Check the local API and active organization session."
        tone="error"
      />
    );
  }

  if (isLoading && runs.length === 0) {
    return <RunDetailLoading />;
  }

  const run = runs.find((candidate) => candidate.id === runId);
  if (!run) {
    return (
      <RunDetailState
        title="Run not found"
        description="No agent_run record is visible for this organization and run id."
      />
    );
  }

  return <RunDetailWorkspaceIsland key={run.id} run={run} />;
}

function RunDetailWorkspaceIsland({ run }: { run: RunViewModelRow }): ReactElement {
  const [eventsCollection] = useState(() => createAgentRunEventsCollection(run.id));
  const [artifactsCollection] = useState(() => createAgentRunArtifactsCollection(run.id));
  const {
    data: events,
    isError: eventsError,
    isLoading: eventsLoading,
  } = useLiveQuery(eventsCollection);
  const { data: artifacts } = useLiveQuery(artifactsCollection);

  return (
    <RunRollout
      run={run}
      feed={selectRunTranscriptFeed(events)}
      artifacts={artifacts}
      transcriptState={getTranscriptState(eventsError, eventsLoading, events.length)}
    />
  );
}

function getTranscriptState(
  isError: boolean,
  isLoading: boolean,
  eventCount: number,
): "error" | "loading" | "ready" {
  if (isError) {
    return "error";
  }

  if (isLoading && eventCount === 0) {
    return "loading";
  }

  return "ready";
}

export function RunDetailLoading(): ReactElement {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" padding={4}>
          <Center>
            <Text type="supporting" color="secondary">
              Loading run…
            </Text>
          </Center>
        </LayoutContent>
      }
    />
  );
}

function RunDetailState({
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
