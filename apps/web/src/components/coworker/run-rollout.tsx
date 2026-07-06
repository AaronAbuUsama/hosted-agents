"use client";

import { useState, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
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
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { ArrowTopRightOnSquareIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

import type { Coworker, Run, RunStatus } from "@/lib/coworker-data";

type RunRolloutProps = {
  coworker?: Coworker;
  initialTab?: RunDetailTab;
  run: Run;
};

export type RunDetailTab = "timeline" | "transcript" | "github";

const statusDotVariants: Record<RunStatus, "accent" | "warning" | "success" | "error"> = {
  Running: "accent",
  "Needs review": "warning",
  Blocked: "error",
  Completed: "success",
};

const defaultTab: RunDetailTab = "timeline";

function getStepVariant(
  run: Run,
  index: number,
  total: number,
): "accent" | "warning" | "success" | "error" {
  const isLastStep = index === total - 1;

  if (!isLastStep || run.status === "Completed") {
    return "success";
  }

  return statusDotVariants[run.status];
}

function getStepLabel(run: Run, index: number, total: number): string {
  const isLastStep = index === total - 1;
  if (!isLastStep || run.status === "Completed") {
    return "Completed";
  }

  return run.status;
}

function getGitHubHref(run: Run): string {
  return `https://github.com/${run.repo}/tree/${run.branch}`;
}

export default function RunRollout({
  coworker,
  initialTab = defaultTab,
  run,
}: RunRolloutProps): ReactElement {
  const [activeTab, setActiveTab] = useState<RunDetailTab>(initialTab);
  const coworkerName = coworker?.name ?? "Coworker";
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
                      <Avatar name={coworkerName} size="xsmall" />
                      <Text type="supporting">{coworkerName}</Text>
                    </HStack>
                    <Token label={run.repo} />
                    <Token label={run.branch} />
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {run.started} / {run.duration}
                    </Text>
                  </HStack>
                </VStack>
              </StackItem>
              <Link href={githubHref} isStandalone isExternalLink>
                Open GitHub
              </Link>
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
          {activeTab === "timeline" ? <TimelineTab run={run} /> : null}
          {activeTab === "transcript" ? (
            <TranscriptTab run={run} coworkerName={coworkerName} />
          ) : null}
          {activeTab === "github" ? (
            <GitHubTab run={run} coworkerName={coworkerName} githubHref={githubHref} />
          ) : null}
        </LayoutContent>
      }
    />
  );
}

function TimelineTab({ run }: { run: Run }): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Timeline</Heading>
          <Text type="supporting" color="secondary">
            Ordered run events from trigger through the current output.
          </Text>
        </VStack>
        <List hasDividers density="balanced" header="Run timeline">
          {run.timeline.map((event, index) => (
            <ListItem
              key={event}
              label={event}
              description={getStepLabel(run, index, run.timeline.length)}
              startContent={
                <StatusDot
                  variant={getStepVariant(run, index, run.timeline.length)}
                  label={getStepLabel(run, index, run.timeline.length)}
                />
              }
            />
          ))}
        </List>
      </VStack>
    </Section>
  );
}

function TranscriptTab({ run, coworkerName }: { run: Run; coworkerName: string }): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Transcript</Heading>
          <Text type="supporting" color="secondary">
            Messages emitted by GitHub and the coworker during this run.
          </Text>
        </VStack>
        <List hasDividers density="balanced" header="Run transcript">
          {run.transcript.map((entry, index) => (
            <ListItem
              key={`${entry.speaker}-${index}`}
              label={entry.speaker}
              description={
                <Markdown density="compact" contentWidth="100%">
                  {entry.message}
                </Markdown>
              }
              startContent={
                entry.speaker === "GitHub" ? (
                  <Icon icon={DocumentTextIcon} size="md" color="secondary" />
                ) : (
                  <Avatar name={entry.speaker || coworkerName} size="small" />
                )
              }
            />
          ))}
        </List>
      </VStack>
    </Section>
  );
}

function GitHubTab({
  run,
  coworkerName,
  githubHref,
}: {
  run: Run;
  coworkerName: string;
  githubHref: string;
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
          <Link href={githubHref} isStandalone isExternalLink>
            <HStack gap={1} vAlign="center">
              <Icon icon={ArrowTopRightOnSquareIcon} size="sm" />
              <Text type="body">Open source</Text>
            </HStack>
          </Link>
        </HStack>
        <MetadataList columns="multi" label={{ position: "top" }}>
          <MetadataListItem label="Repository">{run.repo}</MetadataListItem>
          <MetadataListItem label="Branch">{run.branch}</MetadataListItem>
          <MetadataListItem label="Trigger">{run.trigger}</MetadataListItem>
          <MetadataListItem label="Coworker">{coworkerName}</MetadataListItem>
          <MetadataListItem label="Started">{run.started}</MetadataListItem>
          <MetadataListItem label="Duration">{run.duration}</MetadataListItem>
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
