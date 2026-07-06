"use client";

import { useRef, useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import {
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
} from "@astryxdesign/core/Chat";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Section } from "@astryxdesign/core/Section";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import {
  ChevronRightIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  ShareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import type { Coworker, Run } from "@/lib/coworker-data";

const mobileMaxWidth = 767;

const root: CSSProperties = {
  height: "100%",
  width: "100%",
  containerType: "inline-size",
  containerName: "artifact",
};

const rolloutColumn: CSSProperties = {
  flex: 1,
  width: "100%",
  minWidth: 0,
  height: "100%",
};

const rolloutLayout: CSSProperties = {
  flex: 1,
  minHeight: 0,
};

const artifactCard: CSSProperties = {
  marginBlockStart: "var(--spacing-2)",
};

const artifactScroll: CSSProperties = {
  flex: 1,
  overflowY: "auto",
};

const articleBody: CSSProperties = {
  maxWidth: 720,
  marginInline: "auto",
};

function getArtifactPanelStyle(size: number | string): CSSProperties {
  return {
    "--artifact-panel-width": typeof size === "number" ? `${size}px` : size,
  } as CSSProperties;
}

const runRolloutCss = `
.run-rollout-resize-handle {
  display: flex;
}
.run-rollout-artifact-panel {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: var(--artifact-panel-width);
  flex-shrink: 0;
}
@container artifact (max-width: ${mobileMaxWidth}px) {
  .run-rollout-resize-handle {
    display: none;
  }
  .run-rollout-artifact-panel {
    display: none;
    width: 100%;
    flex-shrink: 1;
  }
}
`;

const promptTitle = "Review PR #482: prompt and skills";
const promptSubtitle = "Run context · Abu Bakr by Coworker";
const promptMenuItems = [
  { label: "Prompt" },
  { label: "Skills" },
  { label: "GitHub output" },
];

const promptContent = `## User prompt

Review PR #482 in \`coworker/web\`. Leave inline comments for correctness risks, silent failures, and migration ordering. Wait for CI before approving.

## System instructions

- Follow repository agent conventions before commenting.
- Prefer inline comments for specific code issues.
- Post a required check summary after review.
- Do not approve until CI is green.

## Skills loaded

| Skill | Why it matters |
| --- | --- |
| code-reviewer | Review changed files for correctness and maintainability |
| silent-failure-hunter | Find swallowed errors and unsafe fallbacks |
| diagnose | Trace failing auth/provider behavior before suggesting fixes |

## GitHub context

- Repository: \`coworker/web\`
- Branch: \`feature/github-app-install\`
- Event: \`pull_request.opened\`
- Coworker identity: Abu Bakr by Coworker

## Expected output

1. Inline comments on blocking issues
2. Summary comment on the PR
3. Required check status
4. Approval only after CI passes`;

type RunRolloutProps = {
  coworker?: Coworker;
  run: Run;
};

export default function RunRollout({ coworker, run }: RunRolloutProps): ReactElement {
  const [isArtifactDialogOpen, setIsArtifactDialogOpen] = useState(false);
  const [isArtifactOpen, setIsArtifactOpen] = useState(true);
  const rootRef = useRef<HTMLElement>(null);
  const artifactResize = useResizable({
    defaultSize: 560,
    minSizePx: 440,
    maxSizePx: 840,
    autoSaveId: "coworker-run-rollout-artifact-panel",
  });
  const coworkerName = coworker?.name ?? "Coworker";

  function openArtifact(): void {
    const rootWidth = rootRef.current?.offsetWidth ?? Infinity;
    if (rootWidth <= mobileMaxWidth) {
      setIsArtifactDialogOpen(true);
      return;
    }

    setIsArtifactOpen(true);
  }

  return (
    <VStack ref={rootRef} style={root}>
      <style>{runRolloutCss}</style>
      <Layout
        height="fill"
        content={
          <LayoutContent padding={0}>
            <HStack height="100%">
              <VStack style={rolloutColumn}>
                <ChatLayout density="spacious" style={rolloutLayout} composer={null}>
                  <ChatMessageList>
                    <ChatSystemMessage variant="divider">{run.started}</ChatSystemMessage>

                    <ChatMessage sender="user">
                      <HStack gap={1} wrap="wrap">
                        <Token label={run.repo} />
                        <Token label={run.branch} />
                        <Token label={run.trigger} />
                      </HStack>
                      <ChatMessageBubble
                        metadata={
                          <ChatMessageMetadata
                            timestamp={<Timestamp value="2026-07-05T18:10:00" format="time" />}
                          />
                        }
                      >
                        PR #482 opened. Abu Bakr should review the diff, leave inline comments, and post the required check.
                      </ChatMessageBubble>
                    </ChatMessage>

                    <ChatMessage sender="assistant" avatar={<Avatar name={coworkerName} size="small" />}>
                      <ChatMessageBubble variant="ghost">
                        I’m loading the pull request diff and repository instructions before writing comments.
                      </ChatMessageBubble>
                      <ChatToolCalls
                        defaultIsExpanded
                        calls={[
                          { name: "read", target: "AGENTS.md", status: "complete", duration: "42ms" },
                          { name: "read", target: "apps/web/src/app/(app)/app/settings/page.tsx", status: "complete", duration: "58ms" },
                          { name: "bash", target: "bunx next build", status: "running", duration: "4.8s", node: "sandbox" },
                        ]}
                      />
                      <ChatMessageBubble variant="ghost">
                        <Markdown density="compact">{`Found two review targets so far:

1. Provider credential state can silently fall through when the organization is missing a connected account.
2. The GitHub App setup copy does not explain which named coworker identity will post the check.

I’m preparing inline comments and waiting for CI before final approval.`}</Markdown>
                      </ChatMessageBubble>
                      <ChatMessageBubble variant="ghost">
                        <CodeBlock
                          title="apps/web/src/components/coworker/auth-form.tsx"
                          language="typescript"
                          code={`if (!providerAccount) {
  return {
    status: "blocked",
    reason: "Provider account missing",
  };
}

return startSandboxRun({
  coworkerId,
  repositoryId,
});`}
                        />
                      </ChatMessageBubble>
                      <ChatMessageMetadata
                        timestamp={<Timestamp value="2026-07-05T18:12:00" format="time" />}
                        footer={<Text type="supporting">{coworkerName}</Text>}
                      />
                    </ChatMessage>

                    <ChatSystemMessage>CI still running · final approval held</ChatSystemMessage>

                    <ChatMessage sender="assistant" avatar={<Avatar name={coworkerName} size="small" />}>
                      <ChatMessageBubble variant="ghost">
                        <Markdown density="compact">{`I drafted the review summary and linked the run prompt below. The prompt explains why I am waiting for CI and which skills are active for this review.`}</Markdown>
                      </ChatMessageBubble>
                      <ArtifactCard onOpen={openArtifact} />
                      <ChatToolCalls
                        calls={[
                          { name: "edit", target: "GitHub inline comments", status: "running", node: "sandbox" },
                        ]}
                      />
                      <ChatMessageMetadata timestamp={<Timestamp value="2026-07-05T18:14:00" format="time" />} />
                    </ChatMessage>
                  </ChatMessageList>
                </ChatLayout>
              </VStack>

              {isArtifactOpen && (
                <>
                  <ResizeHandle
                    direction="horizontal"
                    resizable={artifactResize.props}
                    isReversed
                    pillPlacement="start"
                    hasDivider
                    label="Resize run detail panel"
                    className="run-rollout-resize-handle"
                  />

                  <Card
                    variant="transparent"
                    height="100%"
                    className="run-rollout-artifact-panel"
                    style={getArtifactPanelStyle(artifactResize.size)}
                  >
                    <Toolbar
                      label="Run detail actions"
                      dividers={["bottom"]}
                      startContent={
                        <HStack gap={3} vAlign="center">
                          <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
                          <ArtifactTitle subtitle={promptSubtitle} />
                        </HStack>
                      }
                      endContent={<ArtifactActions onClose={() => setIsArtifactOpen(false)} />}
                    />
                    <ArtifactBody />
                  </Card>
                </>
              )}
            </HStack>
          </LayoutContent>
        }
      />
      <Dialog
        isOpen={isArtifactDialogOpen}
        onOpenChange={setIsArtifactDialogOpen}
        purpose="info"
        variant="fullscreen"
      >
        <Layout
          header={
            <DialogHeader
              title={promptTitle}
              subtitle={promptSubtitle}
              hasDivider
              onOpenChange={setIsArtifactDialogOpen}
              endContent={<MobileArtifactActions />}
            />
          }
          content={
            <LayoutContent padding={0}>
              <ArtifactBody />
            </LayoutContent>
          }
        />
      </Dialog>
    </VStack>
  );
}

type ArtifactActionsProps = {
  onClose?: () => void;
};

function ArtifactActions({ onClose }: ArtifactActionsProps): ReactElement {
  return (
    <>
      <DropdownMenu
        button={{ label: "Prompt", variant: "ghost", size: "sm" }}
        items={promptMenuItems}
      />
      <Button
        label="Copy"
        variant="ghost"
        size="sm"
        icon={<Icon icon={ClipboardDocumentIcon} size="sm" />}
        isIconOnly
      />
      <Button
        label="Share"
        variant="ghost"
        size="sm"
        icon={<Icon icon={ShareIcon} size="sm" />}
        isIconOnly
      />
      {onClose != null && (
        <Button
          label="Close details"
          variant="ghost"
          size="sm"
          icon={<Icon icon={XMarkIcon} size="sm" />}
          isIconOnly
          onClick={onClose}
        />
      )}
    </>
  );
}

function MobileArtifactActions(): ReactElement {
  return (
    <MoreMenu
      label="Run detail actions"
      size="sm"
      items={[
        { type: "section", title: "View", items: promptMenuItems },
        { type: "divider" },
        { label: "Copy", icon: ClipboardDocumentIcon },
        { label: "Share", icon: ShareIcon },
      ]}
    />
  );
}

type ArtifactTitleProps = {
  subtitle: string;
};

function ArtifactTitle({ subtitle }: ArtifactTitleProps): ReactElement {
  return (
    <VStack gap={0}>
      <Text type="label" weight="semibold">
        {promptTitle}
      </Text>
      <Text type="supporting" color="secondary">
        {subtitle}
      </Text>
    </VStack>
  );
}

function ArtifactBody(): ReactElement {
  return (
    <Section variant="transparent" style={artifactScroll}>
      <VStack gap={2} style={articleBody}>
        <Heading level={1}>{promptTitle}</Heading>
        <Markdown>{promptContent}</Markdown>
      </VStack>
    </Section>
  );
}

type ArtifactCardProps = {
  onOpen: () => void;
};

function ArtifactCard({ onOpen }: ArtifactCardProps): ReactElement {
  return (
    <ClickableCard
      label={`Open ${promptTitle}`}
      onClick={onOpen}
      variant="muted"
      padding={3}
      maxWidth={360}
      style={artifactCard}
    >
      <HStack gap={3} vAlign="center" width="100%">
        <Icon icon={DocumentTextIcon} size="md" color="secondary" />
        <StackItem size="fill">
          <ArtifactTitle subtitle="Prompt and active skills" />
        </StackItem>
        <Icon icon={ChevronRightIcon} size="sm" color="secondary" />
      </HStack>
    </ClickableCard>
  );
}
