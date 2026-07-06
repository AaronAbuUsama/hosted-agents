"use client";

import { Fragment, useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
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
import {
  Table,
  TableCell,
  TableRow,
  pixel,
  proportional,
  resolveColumnWidths,
} from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

import {
  runStatusBadgeVariants,
  type Coworker,
  type Project,
  type ProjectIssue,
  type ProjectIssueComment,
  type ProjectIssueStatus,
  type Run,
} from "@/lib/coworker-data";

type IssueDetailProps = {
  project: Project;
  issue: ProjectIssue;
  comments: ProjectIssueComment[];
  runs: Run[];
  assignee?: Coworker;
  reviewer?: Coworker;
  initialTab?: IssueDetailTab;
};

type AssociatedRun = Run & {
  coworkerName: string;
};

export type IssueDetailTab = "details" | "comments" | "runs" | "github";

const statusDotVariants: Record<ProjectIssueStatus, "neutral" | "accent" | "warning" | "success"> =
  {
    Backlog: "neutral",
    Ready: "accent",
    "In progress": "warning",
    "In review": "warning",
    Done: "success",
  };

const roleBadgeVariants: Record<ProjectIssueComment["role"], "blue" | "green" | "neutral"> = {
  Human: "neutral",
  Coworker: "blue",
  GitHub: "green",
};

const runColumns: TableColumn<AssociatedRun>[] = [
  { key: "status", header: "", width: pixel(44) },
  { key: "run", header: "Run", width: proportional(1) },
  { key: "coworker", header: "Coworker", width: pixel(132) },
  { key: "started", header: "Started", width: pixel(104) },
  { key: "duration", header: "Duration", width: pixel(88) },
  { key: "result", header: "Result", width: proportional(1) },
  { key: "actions", header: "", width: pixel(48) },
];

const resolvedRunColumnWidths = resolveColumnWidths(runColumns);

const contentStyle: CSSProperties = {
  minWidth: 0,
};

const commentComposerStyle: CSSProperties = {
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-element)",
  padding: "var(--spacing-4)",
};

const runRowStyle: CSSProperties = {
  cursor: "pointer",
};

function labelText(label: string): string {
  return label.replace(/^coworker:/, "");
}

function IssueMetadata({
  issue,
  project,
  assignee,
  reviewer,
}: {
  issue: ProjectIssue;
  project: Project;
  assignee?: Coworker;
  reviewer?: Coworker;
}): ReactElement {
  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="label">Status</Text>
        <HStack gap={2} vAlign="center">
          <StatusDot variant={statusDotVariants[issue.status]} label={issue.status} />
          <Text>{issue.status}</Text>
        </HStack>
      </VStack>
      <MetadataList label={{ position: "start" }}>
        <MetadataListItem label="Repository">{project.repo}</MetadataListItem>
        <MetadataListItem label="Opened">{issue.opened}</MetadataListItem>
        <MetadataListItem label="Opened by">{issue.openedBy}</MetadataListItem>
        <MetadataListItem label="Updated">{issue.updated}</MetadataListItem>
        <MetadataListItem label="Comments">{issue.comments}</MetadataListItem>
      </MetadataList>
      <Divider />
      <VStack gap={2}>
        <Text type="label">People</Text>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center">
            <Avatar name={issue.assignee} size="xsmall" />
            <VStack gap={0}>
              <Text>{issue.assignee}</Text>
              <Text type="supporting" color="secondary">
                {assignee ? "Assigned coworker" : "Assignee"}
              </Text>
            </VStack>
          </HStack>
          {reviewer ? (
            <HStack gap={2} vAlign="center">
              <Avatar name={reviewer.name} size="xsmall" />
              <VStack gap={0}>
                <Text>{reviewer.name}</Text>
                <Text type="supporting" color="secondary">
                  Reviewer coworker
                </Text>
              </VStack>
            </HStack>
          ) : null}
        </VStack>
      </VStack>
      <Divider />
      <VStack gap={2}>
        <Text type="label">Labels</Text>
        <HStack gap={1} wrap="wrap">
          {issue.labels.map((label) => (
            <Token key={label} label={labelText(label)} />
          ))}
        </HStack>
      </VStack>
    </VStack>
  );
}

function CommentRow({ comment }: { comment: ProjectIssueComment }): ReactElement {
  return (
    <HStack gap={3} vAlign="start">
      <Avatar name={comment.author} size="small" />
      <StackItem size="fill">
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text weight="semibold">{comment.author}</Text>
            <Badge variant={roleBadgeVariants[comment.role]} label={comment.role} />
            <Text type="supporting" color="secondary">
              {comment.time}
            </Text>
          </HStack>
          <Markdown density="compact" headingLevelStart={4} autolink="gfm">
            {comment.body}
          </Markdown>
        </VStack>
      </StackItem>
    </HStack>
  );
}

function AssociatedRunsTable({
  runs,
  coworkerNameById,
}: {
  runs: AssociatedRun[];
  coworkerNameById: Record<string, string>;
}): ReactElement {
  const router = useRouter();

  if (runs.length === 0) {
    return (
      <Stack style={commentComposerStyle}>
        <Text type="body" color="secondary">
          No coworker runs are attached to this issue yet.
        </Text>
      </Stack>
    );
  }

  return (
    <Table columns={runColumns} density="balanced" dividers="rows" textOverflow="truncate" hasHover>
      <colgroup>
        {runColumns.map((column) => (
          <col key={column.key} style={resolvedRunColumnWidths.columns.get(column.key)?.style} />
        ))}
      </colgroup>
      <tbody>
        {runs.map((run) => (
          <TableRow
            key={run.id}
            role="link"
            tabIndex={0}
            style={runRowStyle}
            onClick={() => router.push(`/app/runs/${run.id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                router.push(`/app/runs/${run.id}`);
              }
            }}
          >
            <TableCell>
              <Center axis="horizontal">
                <Icon icon={PlayCircleIcon} size="sm" color="secondary" />
              </Center>
            </TableCell>
            <TableCell>
              <VStack gap={0}>
                <Text type="body" weight="semibold" maxLines={1}>
                  {run.title}
                </Text>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {run.branch}
                </Text>
              </VStack>
            </TableCell>
            <TableCell>
              <HStack gap={2} vAlign="center">
                <Avatar name={run.coworkerName} size="xsmall" />
                <Text maxLines={1}>{coworkerNameById[run.coworkerId] ?? run.coworkerName}</Text>
              </HStack>
            </TableCell>
            <TableCell>
              <Text type="supporting">{run.started}</Text>
            </TableCell>
            <TableCell>
              <Text type="supporting" hasTabularNumbers>
                {run.duration}
              </Text>
            </TableCell>
            <TableCell>
              <HStack gap={2} vAlign="center">
                <Badge variant={runStatusBadgeVariants[run.status]} label={run.status} />
                <Text type="body" color="secondary" maxLines={1}>
                  {run.result}
                </Text>
              </HStack>
            </TableCell>
            <TableCell>
              <Link
                href={`/app/runs/${run.id}`}
                isStandalone
                onClick={(event) => event.stopPropagation()}
              >
                Open
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}

function GitHubSourcePanel({
  project,
  issue,
  runCount,
}: {
  project: Project;
  issue: ProjectIssue;
  runCount: number;
}): ReactElement {
  return (
    <VStack gap={5}>
      <VStack gap={2}>
        <Heading level={2}>GitHub source</Heading>
        <Text type="body" color="secondary" as="p">
          Source metadata from the linked GitHub issue. Coworker runs and comments stay mapped back
          to this issue number.
        </Text>
      </VStack>
      <MetadataList label={{ position: "start" }}>
        <MetadataListItem label="Repository">{project.repo}</MetadataListItem>
        <MetadataListItem label="Issue">#{issue.number}</MetadataListItem>
        <MetadataListItem label="Opened">{issue.opened}</MetadataListItem>
        <MetadataListItem label="Opened by">{issue.openedBy}</MetadataListItem>
        <MetadataListItem label="Updated">{issue.updated}</MetadataListItem>
        <MetadataListItem label="Comments">{issue.comments}</MetadataListItem>
        <MetadataListItem label="Associated runs">{runCount}</MetadataListItem>
      </MetadataList>
      <Divider />
      <VStack gap={2}>
        <Text type="label">Labels</Text>
        <HStack gap={1} wrap="wrap">
          {issue.labels.map((label) => (
            <Token key={label} label={labelText(label)} />
          ))}
        </HStack>
      </VStack>
      <HStack>
        <Button
          label="Open GitHub"
          variant="primary"
          icon={<Icon icon={ArrowTopRightOnSquareIcon} />}
          onClick={() => window.open(issue.githubUrl, "_blank", "noopener,noreferrer")}
        />
      </HStack>
    </VStack>
  );
}

export default function IssueDetail({
  project,
  issue,
  comments,
  runs,
  assignee,
  reviewer,
  initialTab = "details",
}: IssueDetailProps): ReactElement {
  const [activeTab, setActiveTab] = useState<IssueDetailTab>(initialTab);
  const [draftComment, setDraftComment] = useState("");
  const [localComments, setLocalComments] = useState<ProjectIssueComment[]>(comments);
  const isNarrow = useMediaQuery("(max-width: 1040px)");
  const coworkerNameById: Record<string, string> = {
    ...(assignee ? { [assignee.id]: assignee.name } : {}),
    ...(reviewer ? { [reviewer.id]: reviewer.name } : {}),
  };
  const associatedRuns: AssociatedRun[] = runs.map((run) => ({
    ...run,
    coworkerName: coworkerNameById[run.coworkerId] ?? "Coworker",
  }));
  const visibleCommentCount = localComments.length;
  const commentCount = issue.comments + Math.max(0, localComments.length - comments.length);
  const canPostComment = draftComment.trim().length > 0;

  function postComment(): void {
    const body = draftComment.trim();
    if (!body) {
      return;
    }

    setLocalComments((current) => [
      ...current,
      {
        id: `local-comment-${Date.now()}`,
        issueId: issue.id,
        author: "You",
        role: "Human",
        time: "Just now",
        body,
      },
    ]);
    setDraftComment("");
  }

  function changeTab(nextTab: IssueDetailTab): void {
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
      defaultHasDividers
      header={
        <LayoutHeader hasDivider padding={3}>
          <VStack gap={3}>
            <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Link href={`/app/projects/${project.id}`} color="secondary">
                  <HStack gap={1} vAlign="center">
                    <Icon icon={ArrowLeftIcon} size="sm" color="inherit" />
                    {project.name}
                  </HStack>
                </Link>
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  #{issue.number}
                </Text>
                <StatusDot variant={statusDotVariants[issue.status]} label={issue.status} />
                <Text type="supporting" color="secondary">
                  {issue.status}
                </Text>
              </HStack>
              <Button
                label="Open GitHub"
                variant="secondary"
                size="sm"
                icon={<Icon icon={ArrowTopRightOnSquareIcon} />}
                onClick={() => window.open(issue.githubUrl, "_blank", "noopener,noreferrer")}
              />
            </HStack>
            <VStack gap={1}>
              <Heading level={2}>{issue.title}</Heading>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <HStack gap={1} vAlign="center">
                  <Avatar name={issue.assignee} size="xsmall" />
                  <Text type="supporting" maxLines={1}>
                    {issue.assignee}
                  </Text>
                </HStack>
                <HStack gap={1} vAlign="center">
                  <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
                  <Text type="supporting" hasTabularNumbers>
                    {commentCount} comments
                  </Text>
                </HStack>
                <Text type="supporting" color="secondary">
                  Updated {issue.updated}
                </Text>
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {associatedRuns.length} runs
                </Text>
              </HStack>
            </VStack>
            <TabList value={activeTab} onChange={(nextTab) => changeTab(nextTab as IssueDetailTab)}>
              <Tab value="details" label="Details" />
              <Tab value="comments" label="Comments" />
              <Tab value="runs" label="Runs" />
              <Tab value="github" label="GitHub" />
            </TabList>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent isScrollable role="main" padding={5}>
          <VStack gap={6} style={contentStyle}>
            {activeTab === "details" ? (
              <VStack gap={3}>
                <Heading level={2}>Issue details</Heading>
                <Markdown headingLevelStart={3} autolink="gfm" contentWidth="100%">
                  {issue.body}
                </Markdown>
              </VStack>
            ) : null}

            {activeTab === "comments" ? (
              <VStack gap={3}>
                <HStack hAlign="between" vAlign="center" wrap="wrap">
                  <Heading level={2}>Comments</Heading>
                  <Badge variant="neutral" label={`${visibleCommentCount} shown`} />
                </HStack>
                <VStack gap={4}>
                  {localComments.map((comment, index) => (
                    <Fragment key={comment.id}>
                      {index > 0 ? <Divider /> : null}
                      <CommentRow comment={comment} />
                    </Fragment>
                  ))}
                </VStack>
                <Stack style={commentComposerStyle}>
                  <VStack gap={3}>
                    <TextArea
                      label="Leave a comment"
                      value={draftComment}
                      onChange={(value) => setDraftComment(value)}
                      placeholder="Add context, ask for a change, or tag the coworker..."
                      rows={4}
                    />
                    <HStack hAlign="end">
                      <Button
                        label="Post comment"
                        variant="primary"
                        isDisabled={!canPostComment}
                        onClick={postComment}
                      />
                    </HStack>
                  </VStack>
                </Stack>
              </VStack>
            ) : null}

            {activeTab === "runs" ? (
              <VStack gap={3}>
                <HStack hAlign="between" vAlign="center" wrap="wrap">
                  <Heading level={2}>Associated runs</Heading>
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {associatedRuns.length} runs
                  </Text>
                </HStack>
                <AssociatedRunsTable runs={associatedRuns} coworkerNameById={coworkerNameById} />
              </VStack>
            ) : null}

            {activeTab === "github" ? (
              <GitHubSourcePanel project={project} issue={issue} runCount={associatedRuns.length} />
            ) : null}

            {isNarrow ? (
              <>
                <Divider />
                <Stack style={commentComposerStyle}>
                  <IssueMetadata
                    issue={issue}
                    project={project}
                    assignee={assignee}
                    reviewer={reviewer}
                  />
                </Stack>
              </>
            ) : null}
          </VStack>
        </LayoutContent>
      }
      end={
        !isNarrow ? (
          <LayoutPanel width={320} padding={4} role="complementary" label="Issue metadata">
            <IssueMetadata
              issue={issue}
              project={project}
              assignee={assignee}
              reviewer={reviewer}
            />
          </LayoutPanel>
        ) : undefined
      }
    />
  );
}
