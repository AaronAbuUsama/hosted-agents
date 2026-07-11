"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
  type ChatToolCallItem,
} from "@astryxdesign/core/Chat";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ResizeHandle, useResizable, type ResizableProps } from "@astryxdesign/core/Resizable";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import type {
  RunArtifactViewRow,
  RunTranscriptFeedItem,
  RunTranscriptRow,
  RunTranscriptToolCallRow,
  RunViewModelRow,
  RunViewModelStatus,
} from "@/lib/run-view-model";

type TranscriptState = "loading" | "error" | "ready";

type RunRolloutProps = {
  run: RunViewModelRow;
  feed: RunTranscriptFeedItem[];
  artifacts: RunArtifactViewRow[];
  transcriptState: TranscriptState;
};

const statusDotVariants: Record<RunViewModelStatus, StatusDotVariant> = {
  Queued: "neutral",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

const toolInputTargetKeys = ["path", "command", "query", "url", "file"] as const;

const chatLayoutStyle: CSSProperties = { height: "100%", minHeight: 0 };
const panelScroll: CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto" };
// Cap the reading column so the transcript stays comfortable whether the run
// context panel is open or collapsed (matches the ai-chat template's centered
// article column). Without this, closing the panel strands short rows against a
// full-bleed left edge.
const transcriptColumn: CSSProperties = { width: "100%", maxWidth: 880, marginInline: "auto" };

// Branch names run long (`coder/issue-3-add-a-contributing-md-...`); middle-
// truncate so the one-row header keeps its rhythm instead of one token eating it.
function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function getGitHubHref(run: RunViewModelRow): string | null {
  if (run.sourceProvider !== "github" || run.repo === "Unknown repository") {
    return null;
  }

  return `https://github.com/${run.repo}/tree/${run.branch}`;
}

export default function RunRollout({
  run,
  feed,
  artifacts,
  transcriptState,
}: RunRolloutProps): ReactElement {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const githubHref = getGitHubHref(run);
  const panelResize = useResizable({
    defaultSize: 480,
    minSizePx: 360,
    maxSizePx: 720,
    autoSaveId: "run-context-panel",
  });

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={3}>
          <HStack gap={3} vAlign="center" wrap="nowrap">
            <Link href="/app/runs" isStandalone>
              <HStack gap={1} vAlign="center">
                <Icon icon={ArrowLeftIcon} size="sm" />
                <Text type="supporting">Runs</Text>
              </HStack>
            </Link>
            <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
            <Heading level={2}>{run.title}</Heading>
            <Token label={run.repo} size="sm" />
            <Token label={truncateMiddle(run.branch, 34)} size="sm" />
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {run.duration}
            </Text>
            <StackItem size="fill">{null}</StackItem>
            {githubHref ? (
              <Link href={githubHref} isStandalone isExternalLink>
                <Button
                  label="Open on GitHub"
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
                />
              </Link>
            ) : null}
            <Button
              label="Run context"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={ViewColumnsIcon} size="sm" />}
              onClick={() => setIsPanelOpen((open) => !open)}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0}>
          <ChatLayout
            density="spacious"
            style={chatLayoutStyle}
            emptyState={
              <EmptyState
                title="No conversation yet"
                description="This run is visible, but no agent messages have been recorded yet."
                headingLevel={3}
              />
            }
            composer={
              <ChatComposer
                isDisabled
                onSubmit={() => {}}
                placeholder="Steering a run mid-flight is coming soon"
                input={<ChatComposerInput />}
              />
            }
          >
            <TranscriptBody
              feed={feed}
              transcriptState={transcriptState}
              coworkerName={run.coworkerName}
            />
          </ChatLayout>
        </LayoutContent>
      }
      end={
        isPanelOpen ? (
          <>
            <ResizeHandle
              label="Resize run context panel"
              resizable={panelResize.props}
              isReversed
              isAlwaysVisible={false}
            />
            <ContextPanel
              run={run}
              artifacts={artifacts}
              resizable={panelResize.props}
              selectedArtifact={selectedArtifact}
              onSelectArtifact={setSelectedArtifact}
              onClose={() => setIsPanelOpen(false)}
            />
          </>
        ) : null
      }
    />
  );
}

function TranscriptBody({
  feed,
  transcriptState,
  coworkerName,
}: {
  feed: RunTranscriptFeedItem[];
  transcriptState: TranscriptState;
  coworkerName: string;
}): ReactElement | null {
  if (transcriptState === "error") {
    return (
      <Center>
        <Banner
          status="error"
          title="Transcript could not load"
          description="The server did not return run events to reconstruct this conversation."
          container="section"
        />
      </Center>
    );
  }

  if (transcriptState === "loading") {
    return (
      <Center>
        <Text type="supporting" color="secondary">
          Loading transcript…
        </Text>
      </Center>
    );
  }

  // Ready + empty: render nothing so ChatLayout's centered emptyState shows.
  if (feed.length === 0) {
    return null;
  }

  return (
    <VStack style={transcriptColumn}>
      <ChatMessageList density="compact" gap={4}>
        {feed.map((item) =>
          item.kind === "divider" ? (
            <ChatSystemMessage key={item.key} variant="divider">
              {item.label}
            </ChatSystemMessage>
          ) : (
            <TranscriptMessage key={item.key} row={item.row} coworkerName={coworkerName} />
          ),
        )}
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
      <ChatMessage sender="assistant">
        <ChatToolCalls
          calls={[
            {
              key: row.id,
              name: row.toolName ? `${row.toolName} result` : "Tool result",
              status: row.isError ? "error" : "complete",
              resultDetail: (
                <CodeBlock
                  code={row.content || "No tool output."}
                  language="text"
                  hasCopyButton
                  isWrapped
                  width="100%"
                />
              ),
            },
          ]}
        />
      </ChatMessage>
    );
  }

  return (
    <ChatMessage
      sender={row.role}
      avatar={row.role === "assistant" ? <Avatar name={coworkerName} size="small" /> : undefined}
    >
      {row.thinking ? (
        <ChatMessageBubble variant="ghost">
          <VStack gap={1}>
            <Text type="supporting" color="secondary">
              Thinking
            </Text>
            <Markdown density="compact">{row.thinking}</Markdown>
          </VStack>
        </ChatMessageBubble>
      ) : null}
      {row.content ? (
        <ChatMessageBubble variant={row.role === "assistant" ? "ghost" : "filled"}>
          <Markdown density="compact">{row.content}</Markdown>
        </ChatMessageBubble>
      ) : null}
      {row.toolCalls.length > 0 ? (
        <ChatToolCalls calls={row.toolCalls.map(mapTranscriptToolCall)} />
      ) : null}
      <ChatMessageMetadata timestamp={row.timestamp} footer={row.model ?? undefined} />
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

function ContextPanel({
  run,
  artifacts,
  resizable,
  selectedArtifact,
  onSelectArtifact,
  onClose,
}: {
  run: RunViewModelRow;
  artifacts: RunArtifactViewRow[];
  resizable: ResizableProps;
  selectedArtifact: string | null;
  onSelectArtifact: (name: string | null) => void;
  onClose: () => void;
}): ReactElement {
  const selected = artifacts.find((artifact) => artifact.name === selectedArtifact);

  return (
    <LayoutPanel
      hasDivider
      resizable={resizable}
      padding={0}
      role="complementary"
      label="Run context"
    >
      <Toolbar
        label="Run context"
        variant="section"
        startContent={
          <HStack gap={2} vAlign="center">
            {selected ? (
              <Button
                label="Back"
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowLeftIcon} size="sm" />}
                isIconOnly
                onClick={() => onSelectArtifact(null)}
              />
            ) : null}
            <Heading level={3}>{selected ? selected.label : "Run context"}</Heading>
          </HStack>
        }
        endContent={
          <Button
            label="Close panel"
            variant="ghost"
            size="sm"
            icon={<Icon icon={XMarkIcon} size="sm" />}
            isIconOnly
            onClick={onClose}
          />
        }
      />

      <Section variant="transparent" padding={4} style={panelScroll}>
        {selected ? (
          <ArtifactPreview artifact={selected} />
        ) : (
          <VStack gap={5}>
            <MetadataList label={{ position: "top" }}>
              <MetadataListItem label="Trigger">{run.trigger}</MetadataListItem>
              <MetadataListItem label="Started">{run.started}</MetadataListItem>
              <MetadataListItem label="Duration">{run.duration}</MetadataListItem>
              <MetadataListItem label="Result">{run.result}</MetadataListItem>
            </MetadataList>

            <VStack gap={2}>
              <Heading level={4}>Artifacts</Heading>
              {artifacts.length === 0 ? (
                <Text type="supporting" color="secondary">
                  No artifacts for this run.
                </Text>
              ) : (
                artifacts.map((artifact) => (
                  <ClickableCard
                    key={artifact.id}
                    label={`Open ${artifact.label}`}
                    onClick={() => onSelectArtifact(artifact.name)}
                    variant="muted"
                    padding={3}
                  >
                    <HStack gap={3} vAlign="center" width="100%">
                      <Icon icon={DocumentTextIcon} size="md" color="secondary" />
                      <StackItem size="fill">
                        <VStack gap={0}>
                          <Text type="label" weight="semibold">
                            {artifact.label}
                          </Text>
                          <Text type="supporting" color="secondary">
                            {artifact.sizeLabel}
                          </Text>
                        </VStack>
                      </StackItem>
                      <Icon icon={ChevronRightIcon} size="sm" color="secondary" />
                    </HStack>
                  </ClickableCard>
                ))
              )}
            </VStack>
          </VStack>
        )}
      </Section>
    </LayoutPanel>
  );
}

function ArtifactPreview({ artifact }: { artifact: RunArtifactViewRow }): ReactElement {
  if (artifact.kind === "markdown") {
    return <Markdown>{artifact.content}</Markdown>;
  }

  return (
    <CodeBlock
      code={artifact.content}
      language={artifact.language}
      title={artifact.label}
      hasCopyButton
      isWrapped
      width="100%"
    />
  );
}
