"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Markdown } from "@astryxdesign/core/Markdown";
import { useMediaQuery } from "@astryxdesign/core/hooks";
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
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { Token } from "@astryxdesign/core/Token";
import type { IssueStage } from "@hosted-agents/api/issues/stage";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  classifyIssueAuthor,
  formatIssueDate,
  issueAuthorDisplayName,
  issueClaimable,
  issueStage,
  issueStageLabel,
} from "@/lib/issue-detail-view-model";
import { client, orpc } from "@/utils/orpc";

type IssueDetailProps = {
  organizationId: string;
  // github_repository.id — the same id the board uses as the [projectId] segment.
  repositoryId: string;
  // "owner/name", shown in the header and the metadata panel.
  fullName: string;
  issueNumber: number;
};

// The oRPC output types, derived from the router client so the view stays in
// lockstep with the API shape ({ issue, comments } from getRepositoryIssue).
type RepositoryIssue = Awaited<ReturnType<typeof client.getRepositoryIssue>>;
type IssueSummary = RepositoryIssue["issue"];
type IssueComment = RepositoryIssue["comments"][number];

const stageDotVariants: Record<IssueStage, "neutral" | "accent" | "warning" | "success"> = {
  backlog: "neutral",
  ready_for_agent: "accent",
  executing: "warning",
  in_pr: "accent",
  merged: "success",
  failed_blocked: "warning",
};

const contentStyle: CSSProperties = {
  minWidth: 0,
};

const composerStyle: CSSProperties = {
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-element)",
  padding: "var(--spacing-4)",
};

const commentRowStyle: CSSProperties = {
  padding: "var(--spacing-3)",
  borderRadius: "var(--radius-element)",
};

// An agent's comment is set apart with an accent bar + tint so authorship is
// unmistakable at a glance (issue #19 story 17), reinforcing the "Agent" badge.
const agentCommentRowStyle: CSSProperties = {
  ...commentRowStyle,
  borderInlineStart: "var(--spacing-0-5) solid var(--color-accent)",
  backgroundColor: "var(--color-accent-muted)",
};

function openGitHub(url: string | null): void {
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function IssueMetadata({
  issue,
  fullName,
}: {
  issue: IssueSummary;
  fullName: string;
}): ReactElement {
  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="label">Stage</Text>
        <HStack gap={2} vAlign="center">
          <StatusDot variant={stageDotVariants[issueStage(issue)]} label={issueStageLabel(issue)} />
          <Text>{issueStageLabel(issue)}</Text>
        </HStack>
      </VStack>
      <MetadataList label={{ position: "start" }}>
        <MetadataListItem label="Repository">{fullName}</MetadataListItem>
        <MetadataListItem label="Issue">#{issue.number}</MetadataListItem>
        <MetadataListItem label="State">
          {issue.state === "closed" ? "Closed" : "Open"}
        </MetadataListItem>
        <MetadataListItem label="Opened">{formatIssueDate(issue.createdAt)}</MetadataListItem>
        <MetadataListItem label="Opened by">
          {issueAuthorDisplayName(issue.authorLogin)}
        </MetadataListItem>
        <MetadataListItem label="Updated">{formatIssueDate(issue.updatedAt)}</MetadataListItem>
        <MetadataListItem label="Comments">{issue.commentCount}</MetadataListItem>
      </MetadataList>
      <Divider />
      <VStack gap={2}>
        <Text type="label">Labels</Text>
        {issue.labels.length === 0 ? (
          <Text type="supporting" color="secondary">
            No labels
          </Text>
        ) : (
          <HStack gap={1} wrap="wrap">
            {issue.labels.map((label) => (
              <Token key={label} label={label} />
            ))}
          </HStack>
        )}
      </VStack>
    </VStack>
  );
}

function CommentRow({ comment }: { comment: IssueComment }): ReactElement {
  const kind = classifyIssueAuthor(comment.authorLogin);
  const name = issueAuthorDisplayName(comment.authorLogin);
  const isAgent = kind === "agent";

  return (
    <Stack style={isAgent ? agentCommentRowStyle : commentRowStyle}>
      <HStack gap={3} vAlign="start">
        <Avatar name={name} src={comment.authorAvatarUrl ?? undefined} size="small" />
        <StackItem size="fill">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text weight="semibold">{name}</Text>
              <Badge variant={isAgent ? "info" : "neutral"} label={isAgent ? "Agent" : "Member"} />
              <Text type="supporting" color="secondary">
                {formatIssueDate(comment.createdAt)}
              </Text>
            </HStack>
            <Markdown density="compact" headingLevelStart={4} autolink="gfm">
              {comment.body}
            </Markdown>
          </VStack>
        </StackItem>
      </HStack>
    </Stack>
  );
}

export default function IssueDetail({
  organizationId,
  repositoryId,
  fullName,
  issueNumber,
}: IssueDetailProps): ReactElement {
  const showToast = useToast();
  const [draft, setDraft] = useState("");
  const isNarrow = useMediaQuery("(max-width: 1040px)");

  const input = { organizationId, repositoryId, issueNumber };
  const issueQuery = useQuery(orpc.getRepositoryIssue.queryOptions({ input }));

  const postComment = useMutation(
    orpc.postIssueComment.mutationOptions({
      onSuccess: async () => {
        setDraft("");
        // Re-read the thread so the confirmed comment lands in order (story 23).
        await issueQuery.refetch();
        showToast({ body: "Comment posted to GitHub." });
      },
      onError: (error) => {
        showToast({
          body: error instanceof Error ? error.message : "Couldn't post the comment.",
          type: "error",
        });
      },
    }),
  );

  if (issueQuery.isLoading) {
    return (
      <Layout
        height="fill"
        content={
          <LayoutContent role="main" padding={4}>
            <Center height="fill" minHeight={240}>
              <Text type="supporting" color="secondary">
                Loading issue…
              </Text>
            </Center>
          </LayoutContent>
        }
      />
    );
  }

  if (issueQuery.error || !issueQuery.data) {
    return (
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={4}>
            <Link href={`/app/projects/${repositoryId}`} color="secondary">
              <HStack gap={1} vAlign="center">
                <Icon icon={ArrowLeftIcon} size="sm" color="inherit" />
                {fullName}
              </HStack>
            </Link>
          </LayoutHeader>
        }
        content={
          <LayoutContent role="main" padding={4}>
            <EmptyState
              title="Couldn't load this issue"
              description={
                issueQuery.error instanceof Error
                  ? issueQuery.error.message
                  : "GitHub did not return this issue. It may have been deleted, or the installation may need attention."
              }
              headingLevel={2}
            />
          </LayoutContent>
        }
      />
    );
  }

  const { issue, comments } = issueQuery.data;
  const stageLabel = issueStageLabel(issue);
  const authorName = issueAuthorDisplayName(issue.authorLogin);
  const canPost = draft.trim().length > 0;
  const claimable = issueClaimable(issue);

  async function submitComment(): Promise<void> {
    const body = draft.trim();
    if (!body) {
      return;
    }
    // The mutation's onError already surfaces the failure as a toast; swallow the
    // rejection here so it doesn't escape the Button's clickAction as unhandled.
    try {
      await postComment.mutateAsync({ ...input, body });
    } catch {
      // handled in onError
    }
  }

  return (
    <Layout
      height="fill"
      contentWidth={1000}
      defaultHasDividers
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={3}>
            <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Link href={`/app/projects/${repositoryId}`} color="secondary">
                  <HStack gap={1} vAlign="center">
                    <Icon icon={ArrowLeftIcon} size="sm" color="inherit" />
                    {fullName}
                  </HStack>
                </Link>
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  #{issue.number}
                </Text>
                <StatusDot variant={stageDotVariants[issueStage(issue)]} label={stageLabel} />
                <Text type="supporting" color="secondary">
                  {stageLabel}
                </Text>
              </HStack>
              <HStack gap={2} vAlign="center" wrap="wrap">
                {claimable ? (
                  <Button
                    label="Kick off agent"
                    variant="primary"
                    size="sm"
                    icon={<Icon icon={PlayCircleIcon} size="sm" />}
                    isDisabled
                    tooltip="Agent execution isn't enabled yet — it arrives with the coding worker role."
                  />
                ) : null}
                <Button
                  label="Open on GitHub"
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={ArrowTopRightOnSquareIcon} />}
                  isDisabled={!issue.htmlUrl}
                  onClick={() => openGitHub(issue.htmlUrl)}
                />
              </HStack>
            </HStack>
            <VStack gap={1}>
              <Heading level={1}>{issue.title}</Heading>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <HStack gap={1} vAlign="center">
                  <Avatar
                    name={authorName}
                    src={issue.authorAvatarUrl ?? undefined}
                    size="xsmall"
                  />
                  <Text type="supporting" maxLines={1}>
                    {authorName}
                  </Text>
                </HStack>
                <HStack gap={1} vAlign="center">
                  <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
                  <Text type="supporting" hasTabularNumbers>
                    {comments.length} comments
                  </Text>
                </HStack>
                <Text type="supporting" color="secondary">
                  Opened {formatIssueDate(issue.createdAt)}
                </Text>
              </HStack>
            </VStack>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent isScrollable role="main" padding={5}>
          <VStack gap={6} style={contentStyle}>
            <VStack gap={3}>
              <Heading level={2}>Description</Heading>
              {issue.body && issue.body.trim().length > 0 ? (
                <Markdown headingLevelStart={3} autolink="gfm" contentWidth="100%">
                  {issue.body}
                </Markdown>
              ) : (
                <Text type="body" color="secondary">
                  No description provided.
                </Text>
              )}
            </VStack>

            <Divider />

            <VStack gap={4}>
              <HStack hAlign="between" vAlign="center" wrap="wrap">
                <Heading level={2}>Comments</Heading>
                <Badge variant="neutral" label={String(comments.length)} />
              </HStack>
              {comments.length === 0 ? (
                <Text type="body" color="secondary">
                  No comments yet. Start the discussion below.
                </Text>
              ) : (
                <VStack gap={3}>
                  {comments.map((comment, index) => (
                    <CommentRow key={comment.githubId ?? `comment-${index}`} comment={comment} />
                  ))}
                </VStack>
              )}
              <Stack style={composerStyle}>
                <VStack gap={3}>
                  <TextArea
                    label="Leave a comment"
                    value={draft}
                    onChange={(value) => setDraft(value)}
                    placeholder="Add context, ask for a change, or reply to the discussion…"
                    rows={4}
                    isDisabled={postComment.isPending}
                  />
                  <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
                    <Text type="supporting" color="secondary">
                      Posts to GitHub as the app identity in this phase.
                    </Text>
                    <Button
                      label="Post comment"
                      variant="primary"
                      isDisabled={!canPost}
                      isLoading={postComment.isPending}
                      clickAction={submitComment}
                    />
                  </HStack>
                </VStack>
              </Stack>
            </VStack>

            {isNarrow ? (
              <>
                <Divider />
                <Stack style={composerStyle}>
                  <IssueMetadata issue={issue} fullName={fullName} />
                </Stack>
              </>
            ) : null}
          </VStack>
        </LayoutContent>
      }
      end={
        !isNarrow ? (
          <LayoutPanel width={320} padding={4} role="complementary" label="Issue metadata">
            <IssueMetadata issue={issue} fullName={fullName} />
          </LayoutPanel>
        ) : undefined
      }
    />
  );
}
