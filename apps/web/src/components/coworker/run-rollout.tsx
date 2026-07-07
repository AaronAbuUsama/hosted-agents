"use client";

import { useState, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatToolCalls,
  type ChatToolCallItem,
} from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
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
import { Token } from "@astryxdesign/core/Token";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";

import type {
  RunTimelineEventRow,
  RunTranscriptRow,
  RunTranscriptToolCallRow,
  RunViewModelRow,
  RunViewModelStatus,
} from "@/lib/run-view-model";

type TimelineState = "loading" | "error" | "ready";

type RunRolloutProps = {
  initialTab?: RunDetailTab;
  run: RunViewModelRow;
  events: RunTimelineEventRow[];
  transcriptRows: RunTranscriptRow[];
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
const toolInputTargetKeys = ["path", "command", "query", "url", "file"] as const;

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
  transcriptRows,
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
          {activeTab === "transcript" ? (
            <TranscriptTab
              rows={transcriptRows}
              timelineState={timelineState}
              coworkerName={run.coworkerName}
            />
          ) : null}
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

function TranscriptTab({
  rows,
  timelineState,
  coworkerName,
}: {
  rows: RunTranscriptRow[];
  timelineState: TimelineState;
  coworkerName: string;
}): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Agent conversation</Heading>
          <Text type="supporting" color="secondary">
            Complete run history: prompt, reasoning, tool calls, and tool results.
          </Text>
        </VStack>
        <TranscriptContent rows={rows} timelineState={timelineState} coworkerName={coworkerName} />
      </VStack>
    </Section>
  );
}

function TranscriptContent({
  rows,
  timelineState,
  coworkerName,
}: {
  rows: RunTranscriptRow[];
  timelineState: TimelineState;
  coworkerName: string;
}): ReactElement {
  if (timelineState === "error") {
    return (
      <Banner
        status="error"
        title="Transcript could not load"
        description="The server did not return Flue event payloads for this run."
        container="section"
      />
    );
  }

  if (timelineState === "loading") {
    return (
      <Center>
        <Text type="supporting" color="secondary">
          Loading transcript…
        </Text>
      </Center>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No transcript events yet"
        description="This run has durable events, but no Flue message_end events are available to reconstruct a transcript."
        headingLevel={3}
      />
    );
  }

  return (
    <ChatMessageList density="compact" gap={4}>
      {rows.map((row) => (
        <TranscriptMessage key={row.id} row={row} coworkerName={coworkerName} />
      ))}
    </ChatMessageList>
  );
}

function TranscriptMessage({
  row,
  coworkerName,
}: {
  row: RunTranscriptRow;
  coworkerName: string;
}): ReactElement {
  if (row.role === "tool") {
    return (
      <ChatMessage
        sender="assistant"
        avatar={<Avatar name={row.toolName ?? "Tool"} size="small" />}
        name={row.toolName ? `${row.toolName} result` : "Tool result"}
        metadata={
          <ChatMessageMetadata
            timestamp={row.timestamp}
            footer={row.isError ? "Failed tool result" : "Tool result"}
          />
        }
      >
        <CodeBlock
          code={row.content || "No tool output."}
          language={codeLanguage(row.content)}
          hasCopyButton
          isWrapped
          width="100%"
        />
      </ChatMessage>
    );
  }

  return (
    <ChatMessage
      sender={row.role}
      avatar={row.role === "assistant" ? <Avatar name={coworkerName} size="small" /> : undefined}
      metadata={
        <ChatMessageMetadata
          timestamp={row.timestamp}
          footer={row.model ?? (row.thinking ? "Reasoning included" : undefined)}
        />
      }
    >
      {row.thinking ? (
        <ChatMessageBubble
          variant="ghost"
          name={row.role === "assistant" ? coworkerName : undefined}
        >
          <VStack gap={2}>
            <Text type="supporting" color="secondary">
              Thinking
            </Text>
            <Markdown density="compact">{row.thinking}</Markdown>
          </VStack>
        </ChatMessageBubble>
      ) : null}
      {row.content ? (
        <ChatMessageBubble
          variant={row.role === "assistant" ? "ghost" : "filled"}
          name={!row.thinking && row.role === "assistant" ? coworkerName : undefined}
        >
          <Markdown density="compact">{row.content}</Markdown>
        </ChatMessageBubble>
      ) : null}
      {row.toolCalls.length > 0 ? (
        <ChatToolCalls calls={row.toolCalls.map(mapTranscriptToolCall)} defaultIsExpanded />
      ) : null}
    </ChatMessage>
  );
}

function mapTranscriptToolCall(toolCall: RunTranscriptToolCallRow): ChatToolCallItem {
  return {
    key: toolCall.id,
    name: toolCall.name,
    status: "complete",
    target: targetForToolInput(toolCall.input),
    resultDetail: (
      <CodeBlock
        code={formatUnknown(toolCall.input)}
        language="json"
        title="Arguments"
        hasCopyButton
        isWrapped
        width="100%"
      />
    ),
  };
}

function targetForToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  for (const key of toolInputTargetKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function formatUnknown(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
}

function codeLanguage(value: string): string {
  try {
    JSON.parse(value);
    return "json";
  } catch {
    return "text";
  }
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
