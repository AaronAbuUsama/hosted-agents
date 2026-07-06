"use client";

import { useState, type ReactElement } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useLiveQuery } from "@tanstack/react-db";

import { agentRunsCollection, createAgentRunEventsCollection } from "@/lib/collections/agent-runs";
import { sortRunTimelineEvents, type RunViewModelRow } from "@/lib/run-view-model";

import RunRollout, { type RunDetailTab } from "./run-rollout";

export type RunDetailDataIslandProps = {
  runId: string;
  initialTab: RunDetailTab;
};

export default function RunDetailDataIsland({
  runId,
  initialTab,
}: RunDetailDataIslandProps): ReactElement {
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

  return <RunDetailEventsIsland key={run.id} run={run} initialTab={initialTab} />;
}

function RunDetailEventsIsland({
  run,
  initialTab,
}: {
  run: RunViewModelRow;
  initialTab: RunDetailTab;
}): ReactElement {
  const [eventsCollection] = useState(() => createAgentRunEventsCollection(run.id));
  const { data: events, isError, isLoading } = useLiveQuery(eventsCollection);
  const timelineState = isError ? "error" : isLoading && events.length === 0 ? "loading" : "ready";

  return (
    <RunRollout
      run={run}
      events={sortRunTimelineEvents(events)}
      timelineState={timelineState}
      initialTab={initialTab}
    />
  );
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
