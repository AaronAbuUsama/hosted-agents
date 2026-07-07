"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";

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
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  Stack,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import {
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CodeBracketSquareIcon,
  CommandLineIcon,
  DocumentTextIcon,
  FolderIcon,
} from "@heroicons/react/24/outline";

import type {
  RunArtifactViewRow,
  RunTimelineEventRow,
  RunTranscriptRow,
  RunTranscriptToolCallRow,
  RunViewModelRow,
  RunViewModelStatus,
} from "@/lib/run-view-model";

type CollectionState = "loading" | "error" | "ready";
type WorkspaceNode = "conversation" | "timeline" | `artifact:${string}`;
type InspectorTab = "run" | "selection";
type OutputTab = "log" | "events";

type RunWorkspaceProps = {
  run: RunViewModelRow;
  events: RunTimelineEventRow[];
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

const styles: Record<string, CSSProperties> = {
  fill: {
    height: "100%",
    minHeight: 0,
  },
  hiddenFill: {
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
  },
  tabListPadding: {
    paddingTop: "var(--spacing-2)",
  },
  codeFill: {
    width: "100%",
    height: "100%",
    borderWidth: 0,
    borderRadius: 0,
  },
  terminalPanel: {
    flexShrink: 0,
    overflow: "hidden",
  },
};

export default function RunWorkspace({
  run,
  events,
  transcriptRows,
  artifacts,
  eventsState,
  artifactsState,
}: RunWorkspaceProps): ReactElement {
  const [activeNode, setActiveNode] = useState<WorkspaceNode>("conversation");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("run");
  const [outputTab, setOutputTab] = useState<OutputTab>("log");
  const isMobile = useMediaQuery("(max-width: 768px)");
  const startPanel = useResizable({
    defaultSize: 320,
    minSizePx: 220,
    maxSizePx: 460,
    collapsible: true,
    collapsedSize: 48,
    autoSaveId: "run-workspace-navigation",
  });
  const endPanel = useResizable({
    defaultSize: 340,
    minSizePx: 240,
    maxSizePx: 520,
    collapsible: true,
    collapsedSize: 48,
    autoSaveId: "run-workspace-inspector",
  });
  const bottomPanel = useResizable({
    defaultSize: 260,
    minSizePx: 96,
    maxSizePx: 420,
    collapsible: true,
    collapsedSize: 44,
    autoSaveId: "run-workspace-output",
  });
  const selectedArtifact = getSelectedArtifact(activeNode, artifacts);
  const selectedView = getSelectedView(activeNode, selectedArtifact);
  const treeItems = useMemo(
    () => buildWorkspaceTree(artifacts, activeNode, setActiveNode),
    [activeNode, artifacts],
  );
  const logArtifact = useMemo(() => selectLogArtifact(artifacts), [artifacts]);

  return (
    <Layout
      height="fill"
      header={<WorkspaceHeader run={run} />}
      start={
        isMobile ? undefined : (
          <>
            {!startPanel.isCollapsed ? (
              <LayoutPanel
                resizable={startPanel.props}
                hasDivider={false}
                padding={3}
                role="navigation"
                label="Run workspace navigation"
              >
                <WorkspaceTree items={treeItems} artifactsState={artifactsState} />
              </LayoutPanel>
            ) : null}
            <ResizeHandle
              direction="horizontal"
              hasDivider
              isAlwaysVisible={false}
              resizable={startPanel.props}
              label="Resize workspace navigation"
            />
          </>
        )
      }
      content={
        <LayoutContent role="main" padding={0}>
          <Stack direction="vertical" style={styles.fill}>
            <StackItem size="fill" style={styles.hiddenFill}>
              <WorkspaceViewer
                run={run}
                selectedView={selectedView}
                selectedArtifact={selectedArtifact}
                artifactsState={artifactsState}
                eventsState={eventsState}
                events={events}
                transcriptRows={transcriptRows}
              />
            </StackItem>
            <ResizeHandle
              direction="vertical"
              hasDivider
              isReversed
              isAlwaysVisible={false}
              resizable={bottomPanel.props}
              label="Resize run output panel"
            />
            {!bottomPanel.isCollapsed ? (
              <StackItem
                style={{
                  ...styles.terminalPanel,
                  height: bottomPanel.size,
                }}
              >
                <OutputPanel
                  activeTab={outputTab}
                  onTabChange={setOutputTab}
                  logArtifact={logArtifact}
                  events={events}
                  eventsState={eventsState}
                />
              </StackItem>
            ) : null}
          </Stack>
        </LayoutContent>
      }
      end={
        isMobile ? undefined : (
          <>
            <ResizeHandle
              direction="horizontal"
              hasDivider
              isReversed
              isAlwaysVisible={false}
              resizable={endPanel.props}
              label="Resize workspace inspector"
            />
            {!endPanel.isCollapsed ? (
              <LayoutPanel
                resizable={endPanel.props}
                hasDivider={false}
                padding={3}
                role="complementary"
                label="Run workspace inspector"
              >
                <InspectorPanel
                  run={run}
                  selectedView={selectedView}
                  selectedArtifact={selectedArtifact}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                />
              </LayoutPanel>
            ) : null}
          </>
        )
      }
    />
  );
}

function WorkspaceHeader({ run }: { run: RunViewModelRow }): ReactElement {
  return (
    <LayoutHeader hasDivider padding={3}>
      <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Link href={`/app/runs/${run.id}`} isStandalone>
              Back to run
            </Link>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {run.id}
            </Text>
          </HStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={1}>{run.title} workspace</Heading>
            <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
            <Text type="supporting">{run.status}</Text>
          </HStack>
        </VStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Token label={run.repo} />
          <Token label={run.branch} />
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {run.duration}
          </Text>
        </HStack>
      </HStack>
    </LayoutHeader>
  );
}

function WorkspaceTree({
  items,
  artifactsState,
}: {
  items: TreeListItemData[];
  artifactsState: CollectionState;
}): ReactElement {
  return (
    <VStack gap={3} style={styles.fill}>
      <VStack gap={1}>
        <Heading level={2}>Workspace</Heading>
        <Text type="supporting" color="secondary">
          Conversation, durable artifacts, and event output for this run.
        </Text>
      </VStack>
      {artifactsState === "error" ? (
        <Banner
          status="error"
          title="Artifacts unavailable"
          description="The server did not return agent_run_artifact rows for this run."
          container="section"
        />
      ) : null}
      <TreeList items={items} density="compact" />
    </VStack>
  );
}

function WorkspaceViewer({
  run,
  selectedView,
  selectedArtifact,
  artifactsState,
  eventsState,
  events,
  transcriptRows,
}: {
  run: RunViewModelRow;
  selectedView: "conversation" | "timeline" | "artifact";
  selectedArtifact: RunArtifactViewRow | null;
  artifactsState: CollectionState;
  eventsState: CollectionState;
  events: RunTimelineEventRow[];
  transcriptRows: RunTranscriptRow[];
}): ReactElement {
  if (selectedView === "conversation") {
    return (
      <Layout
        height="fill"
        header={
          <ViewerHeader
            title="Agent conversation"
            description="Prompt, reasoning, tool calls, and tool results reconstructed from Flue events."
          />
        }
        content={
          <LayoutContent isScrollable padding={4}>
            <ConversationContent
              rows={transcriptRows}
              state={eventsState}
              coworkerName={run.coworkerName}
            />
          </LayoutContent>
        }
      />
    );
  }

  if (selectedView === "timeline") {
    return (
      <Layout
        height="fill"
        header={
          <ViewerHeader
            title="Run timeline"
            description="Durable event sequence from admission through worker cleanup."
          />
        }
        content={
          <LayoutContent isScrollable padding={4}>
            <TimelineContent events={events} state={eventsState} />
          </LayoutContent>
        }
      />
    );
  }

  return (
    <Layout
      height="fill"
      header={
        <ViewerHeader
          title={selectedArtifact?.label ?? "Artifact preview"}
          description={selectedArtifact?.name ?? "Select an artifact from the workspace tree."}
        />
      }
      content={
        <LayoutContent padding={0}>
          <ArtifactContent artifact={selectedArtifact} state={artifactsState} />
        </LayoutContent>
      }
    />
  );
}

function ViewerHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}): ReactElement {
  return (
    <LayoutHeader hasDivider padding={3}>
      <VStack gap={1}>
        <Heading level={2}>{title}</Heading>
        <Text type="supporting" color="secondary">
          {description}
        </Text>
      </VStack>
    </LayoutHeader>
  );
}

function ArtifactContent({
  artifact,
  state,
}: {
  artifact: RunArtifactViewRow | null;
  state: CollectionState;
}): ReactElement {
  if (state === "error") {
    return (
      <Section variant="section" padding={4}>
        <Banner
          status="error"
          title="Artifact could not load"
          description="The server did not return persisted artifact content for this run."
          container="section"
        />
      </Section>
    );
  }

  if (state === "loading") {
    return (
      <Center>
        <Text type="supporting" color="secondary">
          Loading artifacts…
        </Text>
      </Center>
    );
  }

  if (!artifact) {
    return (
      <Section variant="section" padding={4}>
        <EmptyState
          title="No artifacts yet"
          description="This run has no agent_run_artifact rows. Completed code-review runs normally persist review output, GitHub payloads, and sandbox logs."
          headingLevel={3}
        />
      </Section>
    );
  }

  if (artifact.kind === "markdown") {
    return (
      <LayoutContent isScrollable padding={4}>
        <Markdown density="compact">{artifact.content}</Markdown>
      </LayoutContent>
    );
  }

  return (
    <CodeBlock
      code={artifact.content || "No artifact content."}
      language={artifact.language}
      container="section"
      hasLanguageLabel
      hasLineNumbers={artifact.kind !== "log"}
      hasCopyButton
      size="sm"
      style={styles.codeFill}
    />
  );
}

function OutputPanel({
  activeTab,
  onTabChange,
  logArtifact,
  events,
  eventsState,
}: {
  activeTab: OutputTab;
  onTabChange: (value: OutputTab) => void;
  logArtifact: RunArtifactViewRow | null;
  events: RunTimelineEventRow[];
  eventsState: CollectionState;
}): ReactElement {
  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={0}>
          <TabList
            value={activeTab}
            onChange={(value) => onTabChange(value as OutputTab)}
            size="sm"
            hasDivider={false}
            style={styles.tabListPadding}
          >
            <Tab value="log" label="Terminal log" />
            <Tab value="events" label="Events" />
          </TabList>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0}>
          {activeTab === "log" ? (
            <CodeBlock
              code={
                logArtifact?.content ||
                "No sandbox-execution.log artifact was persisted for this run."
              }
              language="text"
              container="section"
              hasLanguageLabel={false}
              hasCopyButton={Boolean(logArtifact)}
              size="sm"
              style={styles.codeFill}
            />
          ) : (
            <LayoutContent isScrollable padding={3}>
              <TimelineContent events={events.slice(-12)} state={eventsState} />
            </LayoutContent>
          )}
        </LayoutContent>
      }
    />
  );
}

function InspectorPanel({
  run,
  selectedView,
  selectedArtifact,
  activeTab,
  onTabChange,
}: {
  run: RunViewModelRow;
  selectedView: "conversation" | "timeline" | "artifact";
  selectedArtifact: RunArtifactViewRow | null;
  activeTab: InspectorTab;
  onTabChange: (value: InspectorTab) => void;
}): ReactElement {
  return (
    <VStack gap={3} style={styles.fill}>
      <SegmentedInspectorTab value={activeTab} onChange={onTabChange} />
      {activeTab === "run" ? <RunMetadata run={run} /> : null}
      {activeTab === "selection" ? (
        <SelectionMetadata selectedView={selectedView} selectedArtifact={selectedArtifact} />
      ) : null}
    </VStack>
  );
}

function SegmentedInspectorTab({
  value,
  onChange,
}: {
  value: InspectorTab;
  onChange: (value: InspectorTab) => void;
}): ReactElement {
  return (
    <TabList
      value={value}
      onChange={(next) => onChange(next as InspectorTab)}
      size="sm"
      layout="fill"
    >
      <Tab value="run" label="Run" />
      <Tab value="selection" label="Selection" />
    </TabList>
  );
}

function RunMetadata({ run }: { run: RunViewModelRow }): ReactElement {
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center">
        <Avatar name={run.coworkerName} size="small" />
        <VStack gap={0.5}>
          <Text type="label">{run.coworkerName}</Text>
          <Text type="supporting" color="secondary">
            {run.runType}
          </Text>
        </VStack>
      </HStack>
      <MetadataList label={{ position: "top" }}>
        <MetadataListItem label="Status">
          <HStack gap={2} vAlign="center">
            <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
            <Text type="body">{run.status}</Text>
          </HStack>
        </MetadataListItem>
        <MetadataListItem label="Repository">{run.repo}</MetadataListItem>
        <MetadataListItem label="Branch">{run.branch}</MetadataListItem>
        <MetadataListItem label="Trigger">{run.trigger}</MetadataListItem>
        <MetadataListItem label="Started">{run.started}</MetadataListItem>
        <MetadataListItem label="Duration">{run.duration}</MetadataListItem>
        <MetadataListItem label="Current stage">{run.currentStage ?? "None"}</MetadataListItem>
        <MetadataListItem label="Result">{run.result}</MetadataListItem>
      </MetadataList>
    </VStack>
  );
}

function SelectionMetadata({
  selectedView,
  selectedArtifact,
}: {
  selectedView: "conversation" | "timeline" | "artifact";
  selectedArtifact: RunArtifactViewRow | null;
}): ReactElement {
  if (selectedView !== "artifact" || !selectedArtifact) {
    return (
      <MetadataList label={{ position: "top" }}>
        <MetadataListItem label="Selection">{humanizeSelection(selectedView)}</MetadataListItem>
        <MetadataListItem label="Type">Run view</MetadataListItem>
      </MetadataList>
    );
  }

  return (
    <MetadataList label={{ position: "top" }}>
      <MetadataListItem label="Name">{selectedArtifact.name}</MetadataListItem>
      <MetadataListItem label="Content type">{selectedArtifact.contentType}</MetadataListItem>
      <MetadataListItem label="Kind">{selectedArtifact.kind}</MetadataListItem>
      <MetadataListItem label="Size">{selectedArtifact.sizeLabel}</MetadataListItem>
      <MetadataListItem label="Created">{selectedArtifact.timestamp}</MetadataListItem>
    </MetadataList>
  );
}

function ConversationContent({
  rows,
  state,
  coworkerName,
}: {
  rows: RunTranscriptRow[];
  state: CollectionState;
  coworkerName: string;
}): ReactElement {
  if (state === "error") {
    return (
      <Banner
        status="error"
        title="Conversation unavailable"
        description="The server did not return event payloads for this run."
        container="section"
      />
    );
  }

  if (state === "loading") {
    return (
      <Center>
        <Text type="supporting" color="secondary">
          Loading conversation…
        </Text>
      </Center>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No conversation events yet"
        description="This run has durable events, but no Flue message_end records are available to reconstruct a conversation."
        headingLevel={3}
      />
    );
  }

  return (
    <ChatMessageList density="compact" gap={4}>
      {rows.map((row) => (
        <ConversationMessage key={row.id} row={row} coworkerName={coworkerName} />
      ))}
    </ChatMessageList>
  );
}

function ConversationMessage({
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

function TimelineContent({
  events,
  state,
}: {
  events: RunTimelineEventRow[];
  state: CollectionState;
}): ReactElement {
  if (state === "error") {
    return (
      <Banner
        status="error"
        title="Events unavailable"
        description="The server did not return agent_run_event rows for this run."
        container="section"
      />
    );
  }

  if (state === "loading") {
    return (
      <Center>
        <Text type="supporting" color="secondary">
          Loading events…
        </Text>
      </Center>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="This run is visible, but no durable event rows have been recorded yet."
        headingLevel={3}
      />
    );
  }

  return (
    <List hasDividers density="compact" header="Event stream">
      {events.map((event) => (
        <ListItem
          key={event.id}
          label={event.message}
          description={
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
          }
          startContent={<StatusDot variant={event.status} label={event.categoryLabel} />}
        />
      ))}
    </List>
  );
}

function buildWorkspaceTree(
  artifacts: RunArtifactViewRow[],
  activeNode: WorkspaceNode,
  onSelect: (node: WorkspaceNode) => void,
): TreeListItemData[] {
  return [
    {
      id: "run-views",
      label: <Text maxLines={1}>Run views</Text>,
      startContent: <Icon icon={FolderIcon} size="xsm" />,
      isExpanded: true,
      children: [
        {
          id: "conversation",
          label: <Text maxLines={1}>Conversation</Text>,
          startContent: <Icon icon={ChatBubbleLeftRightIcon} size="xsm" />,
          isSelected: activeNode === "conversation",
          onClick: () => onSelect("conversation"),
        },
        {
          id: "timeline",
          label: <Text maxLines={1}>Timeline</Text>,
          startContent: <Icon icon={ClockIcon} size="xsm" />,
          isSelected: activeNode === "timeline",
          onClick: () => onSelect("timeline"),
        },
      ],
    },
    {
      id: "artifacts",
      label: <Text maxLines={1}>Artifacts</Text>,
      description: `${artifacts.length} persisted`,
      startContent: <Icon icon={FolderIcon} size="xsm" />,
      isExpanded: true,
      children: artifacts.map((artifact) => ({
        id: `artifact:${artifact.id}`,
        label: <Text maxLines={1}>{artifact.label}</Text>,
        description: artifact.name,
        startContent: <Icon icon={iconForArtifact(artifact)} size="xsm" />,
        endContent: <Text type="supporting">{artifact.sizeLabel}</Text>,
        isSelected: activeNode === `artifact:${artifact.id}`,
        onClick: () => onSelect(`artifact:${artifact.id}`),
      })),
    },
  ];
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

function getSelectedArtifact(
  activeNode: WorkspaceNode,
  artifacts: RunArtifactViewRow[],
): RunArtifactViewRow | null {
  if (!activeNode.startsWith("artifact:")) {
    return null;
  }

  const artifactId = activeNode.slice("artifact:".length);
  return artifacts.find((artifact) => artifact.id === artifactId) ?? artifacts[0] ?? null;
}

function getSelectedView(
  activeNode: WorkspaceNode,
  selectedArtifact: RunArtifactViewRow | null,
): "conversation" | "timeline" | "artifact" {
  if (activeNode === "timeline") {
    return "timeline";
  }

  if (activeNode.startsWith("artifact:") && selectedArtifact) {
    return "artifact";
  }

  return "conversation";
}

function selectLogArtifact(artifacts: RunArtifactViewRow[]): RunArtifactViewRow | null {
  return (
    artifacts.find((artifact) => artifact.name === "sandbox-execution.log") ??
    artifacts.find((artifact) => artifact.kind === "log") ??
    null
  );
}

function iconForArtifact(artifact: RunArtifactViewRow): typeof DocumentTextIcon {
  if (artifact.kind === "json") {
    return CodeBracketSquareIcon;
  }

  if (artifact.kind === "log") {
    return CommandLineIcon;
  }

  return DocumentTextIcon;
}

function humanizeSelection(value: "conversation" | "timeline" | "artifact"): string {
  if (value === "conversation") {
    return "Conversation";
  }

  if (value === "timeline") {
    return "Timeline";
  }

  return "Artifact";
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
