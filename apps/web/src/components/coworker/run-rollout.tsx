"use client";

import { useState, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { Code } from "@astryxdesign/core/Code";
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
import { Markdown } from "@astryxdesign/core/Markdown";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token, type TokenProps } from "@astryxdesign/core/Token";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";

import type {
  RunFindingRow,
  RunFindingSeverity,
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

export type RunDetailTab = "review" | "timeline" | "github";

const statusDotVariants: Record<RunViewModelStatus, StatusDotVariant> = {
  Queued: "neutral",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

const severityTokens: Record<RunFindingSeverity, { label: string; color: TokenProps["color"] }> = {
  high: { label: "High", color: "red" },
  medium: { label: "Medium", color: "orange" },
  low: { label: "Low", color: "yellow" },
  info: { label: "Info", color: "gray" },
};

const defaultTab: RunDetailTab = "review";

function getGitHubHref(run: RunViewModelRow): string | null {
  if (run.sourceProvider !== "github" || run.repo === "Unknown repository") {
    return null;
  }

  if (typeof run.pullRequestNumber === "number") {
    return `https://github.com/${run.repo}/pull/${run.pullRequestNumber}`;
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
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Link href={`/app/runs/${run.id}/workspace`} isStandalone>
                  Open workspace
                </Link>
                {githubHref ? (
                  <Link href={githubHref} isStandalone isExternalLink>
                    Open GitHub
                  </Link>
                ) : null}
              </HStack>
            </HStack>

            {run.status === "Failed" ? (
              <Banner
                status="error"
                title="Run failed"
                description={run.errorMessage ?? "No error message was recorded for this run."}
                endContent={
                  run.currentStage ? <Token label={`Stage: ${run.currentStage}`} /> : undefined
                }
              />
            ) : null}

            <TabList value={activeTab} onChange={(value) => changeTab(value as RunDetailTab)}>
              <Tab value="review" label="Review" />
              <Tab value="timeline" label="Timeline" />
              <Tab value="github" label="GitHub" />
            </TabList>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" isScrollable padding={5}>
          {activeTab === "review" ? <ReviewTab run={run} githubHref={githubHref} /> : null}
          {activeTab === "timeline" ? (
            <TimelineTab events={events} timelineState={timelineState} />
          ) : null}
          {activeTab === "github" ? <GitHubTab run={run} githubHref={githubHref} /> : null}
        </LayoutContent>
      }
    />
  );
}

function ReviewTab({
  run,
  githubHref,
}: {
  run: RunViewModelRow;
  githubHref: string | null;
}): ReactElement {
  if (run.status === "Queued" || run.status === "Running") {
    return (
      <Section variant="section" padding={4}>
        <EmptyState
          title={run.status === "Queued" ? "Run is queued" : "Review in progress"}
          description={
            run.currentStage
              ? `Current stage: ${run.currentStage}. The report appears when the run completes.`
              : "The report appears when the run completes."
          }
          headingLevel={2}
        />
      </Section>
    );
  }

  return (
    <VStack gap={4}>
      <Section variant="section" padding={4}>
        <VStack gap={3}>
          <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
            <Heading level={2}>Summary</Heading>
            {githubHref ? (
              <Link href={githubHref} isStandalone isExternalLink>
                <HStack gap={1} vAlign="center">
                  <Icon icon={ArrowTopRightOnSquareIcon} size="sm" />
                  <Text type="body">View review on GitHub</Text>
                </HStack>
              </Link>
            ) : null}
          </HStack>
          {run.summary ? (
            <Markdown density="compact">{run.summary}</Markdown>
          ) : (
            <Text type="supporting" color="secondary">
              No summary was recorded for this run.
            </Text>
          )}
        </VStack>
      </Section>

      <Section variant="section" padding={4}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>
              {run.findings.length === 0
                ? "Findings"
                : `Findings (${run.findings.length})`}
            </Heading>
            <Text type="supporting" color="secondary">
              Structured review output submitted to GitHub by the reviewer.
            </Text>
          </VStack>
          <FindingsContent run={run} />
        </VStack>
      </Section>
    </VStack>
  );
}

function FindingsContent({ run }: { run: RunViewModelRow }): ReactElement {
  if (run.findings.length === 0) {
    if (run.status === "Failed") {
      return (
        <EmptyState
          title="No review produced"
          description="The run failed before submitting a review. See the error above and the timeline for details."
          headingLevel={3}
        />
      );
    }

    return (
      <EmptyState
        title="No actionable findings"
        description="The reviewer completed without raising issues on this pull request."
        headingLevel={3}
      />
    );
  }

  return (
    <List hasDividers density="balanced">
      {run.findings.map((finding) => (
        <ListItem
          key={finding.id}
          label={finding.title}
          description={<FindingDescription finding={finding} />}
          startContent={
            <Token
              label={severityTokens[finding.severity].label}
              color={severityTokens[finding.severity].color}
            />
          }
        />
      ))}
    </List>
  );
}

function FindingDescription({ finding }: { finding: RunFindingRow }): ReactElement {
  return (
    <VStack gap={2}>
      {finding.file ? (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Code>{finding.line === null ? finding.file : `${finding.file}:${finding.line}`}</Code>
        </HStack>
      ) : null}
      {finding.detail ? <Text type="supporting">{finding.detail}</Text> : null}
      {finding.recommendation ? (
        <Text type="supporting" color="secondary">
          Recommendation: {finding.recommendation}
        </Text>
      ) : null}
    </VStack>
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
            Run milestones from webhook admission to result. The full event stream lives in the
            workspace.
          </Text>
        </VStack>
        <TimelineContent events={events} timelineState={timelineState} />
      </VStack>
    </Section>
  );
}

function TimelineContent({
  events,
  timelineState,
}: {
  events: RunTimelineEventRow[];
  timelineState: TimelineState;
}): ReactElement {
  if (timelineState === "error") {
    return (
      <Banner
        status="error"
        title="Run events could not load"
        description="The server did not return agent_run_event rows for this run."
        container="section"
      />
    );
  }

  if (timelineState === "loading") {
    return (
      <Center>
        <Text type="supporting" color="secondary">
          Loading run events…
        </Text>
      </Center>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="This run is visible, but no agent_run_event rows have been recorded yet."
        headingLevel={3}
      />
    );
  }

  return (
    <List hasDividers density="balanced">
      {events.map((event) => (
        <ListItem
          key={event.id}
          label={event.message}
          description={<TimelineEventDescription event={event} />}
          startContent={<StatusDot variant={event.status} label={event.categoryLabel} />}
        />
      ))}
    </List>
  );
}

function TimelineEventDescription({ event }: { event: RunTimelineEventRow }): ReactElement {
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Token label={event.categoryLabel} />
      <Text type="supporting" color="secondary">
        {event.stageLabel}
      </Text>
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {event.timestamp}
      </Text>
    </HStack>
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
