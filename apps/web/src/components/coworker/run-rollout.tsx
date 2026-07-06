"use client";

import { useState, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";

import type {
  RunTimelineEventRow,
  RunViewModelRow,
  RunViewModelStatus,
} from "@/lib/run-view-model";

type TimelineState = "loading" | "error" | "ready";

type RunRolloutProps = {
  initialTab?: RunDetailTab;
  run: RunViewModelRow;
  events: RunTimelineEventRow[];
  timelineState: TimelineState;
};

export type RunDetailTab = "timeline" | "transcript" | "github";

const statusDotVariants: Record<RunViewModelStatus, StatusDotVariant> = {
  Queued: "neutral",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

const defaultTab: RunDetailTab = "timeline";

function getGitHubHref(run: RunViewModelRow): string | null {
  if (run.sourceProvider !== "github" || run.repo === "Unknown repository") {
    return null;
  }

  return `https://github.com/${run.repo}/tree/${run.branch}`;
}

export default function RunRollout({
  initialTab = defaultTab,
  run,
  events,
  timelineState,
}: RunRolloutProps): ReactElement {
  const [activeTab, setActiveTab] = useState<RunDetailTab>(initialTab);
  const githubHref = getGitHubHref(run);

  function changeTab(nextTab: RunDetailTab): void {
    setActiveTab(nextTab);

    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.replaceState(null, "", url);
  }

  return (
    <Layout
      height="fill"
      contentWidth={1000}
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={4}>
            <Link href="/app/runs" isStandalone>
              Back to runs
            </Link>

            <HStack gap={4} hAlign="between" vAlign="start" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={2}>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {run.id}
                    </Text>
                    <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
                    <Text type="supporting">{run.status}</Text>
                  </HStack>
                  <Heading level={1}>{run.title}</Heading>
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <HStack gap={1} vAlign="center">
                      <Avatar name={run.coworkerName} size="xsmall" />
                      <Text type="supporting">{run.coworkerName}</Text>
                    </HStack>
                    <Token label={run.repo} />
                    <Token label={run.branch} />
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {run.started} / {run.duration}
                    </Text>
                  </HStack>
                </VStack>
              </StackItem>
              {githubHref ? (
                <Link href={githubHref} isStandalone isExternalLink>
                  Open GitHub
                </Link>
              ) : null}
            </HStack>

            <TabList value={activeTab} onChange={(value) => changeTab(value as RunDetailTab)}>
              <Tab value="timeline" label="Timeline" />
              <Tab value="transcript" label="Transcript" />
              <Tab value="github" label="GitHub" />
            </TabList>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" isScrollable padding={5}>
          {activeTab === "timeline" ? (
            <TimelineTab events={events} timelineState={timelineState} />
          ) : null}
          {activeTab === "transcript" ? <TranscriptTab /> : null}
          {activeTab === "github" ? <GitHubTab run={run} githubHref={githubHref} /> : null}
        </LayoutContent>
      }
    />
  );
}

function TimelineTab({
  events,
  timelineState,
}: {
  events: RunTimelineEventRow[];
  timelineState: TimelineState;
}): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Timeline</Heading>
          <Text type="supporting" color="secondary">
            Ordered durable events from webhook admission through the latest worker output.
          </Text>
        </VStack>
        {timelineState === "error" ? (
          <Banner
            status="error"
            title="Run events could not load"
            description="The server did not return agent_run_event rows for this run."
            container="section"
          />
        ) : timelineState === "loading" ? (
          <Center>
            <Text type="supporting" color="secondary">
              Loading run events…
            </Text>
          </Center>
        ) : events.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="This run is visible, but no agent_run_event rows have been recorded yet."
            headingLevel={3}
          />
        ) : (
          <List hasDividers density="balanced" header="Run timeline">
            {events.map((event) => (
              <ListItem
                key={event.id}
                label={event.message}
                description={<TimelineEventDescription event={event} />}
                startContent={<StatusDot variant={event.status} label={event.categoryLabel} />}
              />
            ))}
          </List>
        )}
      </VStack>
    </Section>
  );
}

function TimelineEventDescription({ event }: { event: RunTimelineEventRow }): ReactElement {
  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {event.sequenceLabel}
        </Text>
        <Token label={event.categoryLabel} />
        <Text type="supporting" color="secondary">
          {event.stageLabel}
        </Text>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {event.timestamp}
        </Text>
      </HStack>
      <Text type="supporting" color="secondary">
        {event.typeLabel}
      </Text>
    </VStack>
  );
}

function TranscriptTab(): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <EmptyState
        title="Transcript is not stored yet"
        description="This screen now uses durable run events. A separate runMessages backend model is still needed before chat-style transcripts can be shown without fixtures."
        headingLevel={2}
      />
    </Section>
  );
}

function GitHubTab({
  run,
  githubHref,
}: {
  run: RunViewModelRow;
  githubHref: string | null;
}): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Heading level={2}>GitHub event</Heading>
            <Text type="supporting" color="secondary">
              Source metadata that explains why this run exists.
            </Text>
          </VStack>
          {githubHref ? (
            <Link href={githubHref} isStandalone isExternalLink>
              <HStack gap={1} vAlign="center">
                <Icon icon={ArrowTopRightOnSquareIcon} size="sm" />
                <Text type="body">Open source</Text>
              </HStack>
            </Link>
          ) : null}
        </HStack>
        <MetadataList columns="multi" label={{ position: "top" }}>
          <MetadataListItem label="Repository">{run.repo}</MetadataListItem>
          <MetadataListItem label="Branch">{run.branch}</MetadataListItem>
          <MetadataListItem label="Trigger">{run.trigger}</MetadataListItem>
          <MetadataListItem label="Coworker">{run.coworkerName}</MetadataListItem>
          <MetadataListItem label="Started">{run.started}</MetadataListItem>
          <MetadataListItem label="Duration">{run.duration}</MetadataListItem>
          <MetadataListItem label="Source">{run.sourceProvider}</MetadataListItem>
          <MetadataListItem label="Run type">{run.runType}</MetadataListItem>
          <MetadataListItem label="Current stage">{run.currentStage ?? "None"}</MetadataListItem>
          <MetadataListItem label="Status">
            <HStack gap={2} vAlign="center">
              <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
              <Text type="body">{run.status}</Text>
            </HStack>
          </MetadataListItem>
          <MetadataListItem label="Result">{run.result}</MetadataListItem>
        </MetadataList>
      </VStack>
    </Section>
  );
}
