"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatToolCalls,
  type ChatToolCallItem,
} from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { DocumentTextIcon, XMarkIcon } from "@heroicons/react/24/outline";

import type {
  RunArtifactViewRow,
  RunTranscriptRow,
  RunTranscriptToolCallRow,
  RunViewModelRow,
  RunViewModelStatus,
} from "@/lib/run-view-model";

type CollectionState = "loading" | "error" | "ready";

type RunWorkspaceProps = {
  run: RunViewModelRow;
  transcriptRows: RunTranscriptRow[];
  artifacts: RunArtifactViewRow[];
  eventsState: CollectionState;
  artifactsState: CollectionState;
};

const statusDotVariants: Record<RunViewModelStatus, StatusDotVariant> = {
  Queued: "neutral",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

const toolInputTargetKeys = ["path", "command", "query", "url", "file"] as const;

const fillMinWidth: CSSProperties = { minWidth: 0 };
const transcriptClip: CSSProperties = { minWidth: 0, maxWidth: "100%", overflowX: "hidden" };

export default function RunWorkspace({
  run,
  transcriptRows,
  artifacts,
  eventsState,
  artifactsState,
}: RunWorkspaceProps): ReactElement {
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const openArtifact = openArtifactId
    ? (artifacts.find((artifact) => artifact.id === openArtifactId) ?? null)
    : null;

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={2}>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Link href={`/app/runs/${run.id}`} isStandalone>
                Back to report
              </Link>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {run.id}
              </Text>
            </HStack>
            <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Heading level={1}>{run.title} workspace</Heading>
                <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
                <Text type="supporting">{run.status}</Text>
              </HStack>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Token label={run.repo} />
                <Token label={run.branch} />
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {run.duration}
                </Text>
              </HStack>
            </HStack>
          </VStack>
        </LayoutHeader>
      }
      end={
        <LayoutPanel padding={0} width={openArtifact ? 560 : 320}>
          {openArtifact ? (
            <ArtifactViewer artifact={openArtifact} onClose={() => setOpenArtifactId(null)} />
          ) : (
            <RunFactsPanel
              run={run}
              artifacts={artifacts}
              artifactsState={artifactsState}
              onOpenArtifact={setOpenArtifactId}
            />
          )}
        </LayoutPanel>
      }
      content={
        <LayoutContent role="main" isScrollable padding={5} style={fillMinWidth}>
          <VStack gap={4} style={fillMinWidth}>
            <VStack gap={1}>
              <Heading level={2}>Session transcript</Heading>
              <Text type="supporting" color="secondary">
                What the reviewer did inside the sandbox: prompt, reasoning, tool calls, and tool
                results.
              </Text>
            </VStack>
            <TranscriptContent
              rows={transcriptRows}
              eventsState={eventsState}
              coworkerName={run.coworkerName}
            />
          </VStack>
        </LayoutContent>
      }
    />
  );
}

function RunFactsPanel({
  run,
  artifacts,
  artifactsState,
  onOpenArtifact,
}: {
  run: RunViewModelRow;
  artifacts: RunArtifactViewRow[];
  artifactsState: CollectionState;
  onOpenArtifact: (artifactId: string) => void;
}): ReactElement {
  return (
    <VStack gap={5} padding={4}>
      <VStack gap={3}>
        <Heading level={3}>Run facts</Heading>
        <MetadataList label={{ position: "top" }}>
          <MetadataListItem label="Coworker">{run.coworkerName}</MetadataListItem>
          <MetadataListItem label="Repository">{run.repo}</MetadataListItem>
          <MetadataListItem label="Trigger">{run.trigger}</MetadataListItem>
          <MetadataListItem label="Started">{run.started}</MetadataListItem>
          <MetadataListItem label="Duration">{run.duration}</MetadataListItem>
          <MetadataListItem label="Current stage">{run.currentStage ?? "None"}</MetadataListItem>
        </MetadataList>
      </VStack>

      <VStack gap={2}>
        <Heading level={3}>Artifacts</Heading>
        <ArtifactsList
          artifacts={artifacts}
          artifactsState={artifactsState}
          onOpenArtifact={onOpenArtifact}
        />
      </VStack>
    </VStack>
  );
}

function ArtifactsList({
  artifacts,
  artifactsState,
  onOpenArtifact,
}: {
  artifacts: RunArtifactViewRow[];
  artifactsState: CollectionState;
  onOpenArtifact: (artifactId: string) => void;
}): ReactElement {
  if (artifactsState === "error") {
    return (
      <Banner
        status="error"
        title="Artifacts could not load"
        description="The server did not return agent_run_artifact rows for this run."
      />
    );
  }

  if (artifactsState === "loading") {
    return (
      <Text type="supporting" color="secondary">
        Loading artifacts…
      </Text>
    );
  }

  if (artifacts.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        No artifacts were persisted for this run yet.
      </Text>
    );
  }

  return (
    <List density="compact" hasDividers>
      {artifacts.map((artifact) => (
        <ListItem
          key={artifact.id}
          label={artifact.label}
          description={`${artifact.kind} · ${artifact.sizeLabel}`}
          startContent={<Icon icon={DocumentTextIcon} size="sm" color="secondary" />}
          onClick={() => onOpenArtifact(artifact.id)}
        />
      ))}
    </List>
  );
}

function ArtifactViewer({
  artifact,
  onClose,
}: {
  artifact: RunArtifactViewRow;
  onClose: () => void;
}): ReactElement {
  return (
    <VStack gap={0} height="100%">
      <HStack gap={3} hAlign="between" vAlign="center" padding={3}>
        <HStack gap={2} vAlign="center">
          <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
          <VStack gap={0}>
            <Text type="label" weight="semibold">
              {artifact.label}
            </Text>
            <Text type="supporting" color="secondary">
              {artifact.kind} · {artifact.sizeLabel} · {artifact.timestamp}
            </Text>
          </VStack>
        </HStack>
        <IconButton
          icon={<Icon icon={XMarkIcon} size="sm" />}
          label="Close artifact"
          size="sm"
          onClick={onClose}
        />
      </HStack>
      <StackItem size="fill" style={{ minHeight: 0, overflow: "auto" }}>
        <ArtifactBody artifact={artifact} />
      </StackItem>
    </VStack>
  );
}

function ArtifactBody({ artifact }: { artifact: RunArtifactViewRow }): ReactElement {
  if (artifact.kind === "markdown") {
    return (
      <VStack padding={4}>
        <Markdown density="compact">{artifact.content}</Markdown>
      </VStack>
    );
  }

  return (
    <CodeBlock
      code={artifact.content || "Empty artifact."}
      language={artifact.language}
      hasCopyButton
      isWrapped
      width="100%"
    />
  );
}

function TranscriptContent({
  rows,
  eventsState,
  coworkerName,
}: {
  rows: RunTranscriptRow[];
  eventsState: CollectionState;
  coworkerName: string;
}): ReactElement {
  if (eventsState === "error") {
    return (
      <Banner
        status="error"
        title="Transcript could not load"
        description="The server did not return Flue event payloads for this run."
        container="section"
      />
    );
  }

  if (eventsState === "loading") {
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
        title="No transcript yet"
        description="The session transcript appears once the reviewer starts working in the sandbox."
        headingLevel={3}
      />
    );
  }

  // Tool-call targets (e.g. a long `git diff <sha>..HEAD`) and code blocks can
  // exceed the column; clip at the column edge so they scroll/wrap inside their
  // own box instead of widening the whole page.
  return (
    <VStack gap={4} style={transcriptClip}>
      <ChatMessageList density="compact" gap={4}>
        {rows.map((row) => (
          <TranscriptMessage key={row.id} row={row} coworkerName={coworkerName} />
        ))}
      </ChatMessageList>
    </VStack>
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
