"use client";

import { Fragment, useMemo, useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
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
import { ResizeHandle, useResizable, type ResizableProps } from "@astryxdesign/core/Resizable";
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
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

import type {
  Project,
  ProjectIssue,
  ProjectIssueStatus,
  PullRequestReview,
  Run,
} from "@/lib/coworker-data";

type ProjectWorkspaceProps = {
  project: Project;
  issues: ProjectIssue[];
  reviews: PullRequestReview[];
  runs: Run[];
  hasIssueSync: boolean;
};

type ProjectWorkspaceView = "table" | "board";
type WorkItemKind = "Issue" | "Pull request";
type WorkItemStatus = ProjectIssueStatus;

type WorkItem = {
  id: string;
  kind: WorkItemKind;
  number: number;
  title: string;
  status: WorkItemStatus;
  owner: string;
  source: string;
  labels: string[];
  comments: number;
  updated: string;
  githubUrl: string;
  lastComment: string;
  runId?: string;
};

type WorkItemsProps = {
  workItems: WorkItem[];
  selectedItemId?: string;
  onSelectItem: (item: WorkItem) => void;
  isCompact?: boolean;
};

type WorkItemDetailPanelProps = {
  item: WorkItem;
  onClose: () => void;
  resizable: ResizableProps;
};

const statusOrder: WorkItemStatus[] = ["Ready", "In progress", "In review", "Done", "Backlog"];

const statusLabels: Record<WorkItemStatus, string> = {
  Backlog: "Backlog",
  Ready: "Ready",
  "In progress": "In progress",
  "In review": "In review",
  Done: "Done",
};

const statusDotVariants: Record<WorkItemStatus, "neutral" | "accent" | "warning" | "success"> = {
  Backlog: "neutral",
  Ready: "accent",
  "In progress": "warning",
  "In review": "warning",
  Done: "success",
};

const kindBadgeVariants: Record<WorkItemKind, "blue" | "neutral"> = {
  Issue: "neutral",
  "Pull request": "blue",
};

const reviewStatusToBoardStatus: Record<PullRequestReview["status"], WorkItemStatus> = {
  Reviewing: "In review",
  "Waiting for CI": "In review",
  Approved: "Done",
};

const columns: TableColumn<WorkItem>[] = [
  { key: "status", header: "", width: pixel(44) },
  { key: "item", header: "Issue", width: proportional(1) },
  { key: "owner", header: "Coworker", width: pixel(140) },
  { key: "comments", header: "Comments", width: pixel(116) },
  { key: "updated", header: "Updated", width: pixel(110) },
  { key: "run", header: "Run", width: pixel(112) },
  { key: "actions", header: "", width: pixel(56) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);

const compactColumns: TableColumn<WorkItem>[] = [
  { key: "status", header: "", width: pixel(36) },
  { key: "item", header: "Issue", width: proportional(1) },
  { key: "actions", header: "", width: pixel(48) },
];

const resolvedCompactColumnWidths = resolveColumnWidths(compactColumns);

const groupHeaderCell: CSSProperties = {
  cursor: "pointer",
  backgroundColor: "var(--color-background-muted)",
  padding: "var(--spacing-3) var(--spacing-4)",
};

const workspaceContentStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};

const tableShellStyle: CSSProperties = {
  height: "100%",
  minWidth: 0,
  overflow: "auto",
};

const boardShellStyle: CSSProperties = {
  height: "100%",
  minWidth: 0,
  overflowX: "auto",
  overflowY: "hidden",
  padding: "var(--spacing-3)",
};

const boardColumnStyle: CSSProperties = {
  flex: "0 0 280px",
  height: "100%",
};

const boardCardStyle: CSSProperties = {
  borderRadius: "var(--radius-element)",
};

function getWorkItems(
  issues: ProjectIssue[],
  reviews: PullRequestReview[],
  runs: Run[],
): WorkItem[] {
  const issueItems = issues.map(
    (issue): WorkItem => ({
      id: issue.id,
      kind: "Issue",
      number: issue.number,
      title: issue.title,
      status: issue.status,
      owner: issue.assignee,
      source: "GitHub issue",
      labels: issue.labels,
      comments: issue.comments,
      updated: issue.updated,
      githubUrl: issue.githubUrl,
      lastComment: issue.lastComment,
      runId: issue.linkedRunId,
    }),
  );

  const reviewItems = reviews.map((review): WorkItem => {
    const run = runs.find((candidate) => candidate.branch === review.branch);

    return {
      id: review.id,
      kind: "Pull request",
      number: review.number,
      title: review.title,
      status: reviewStatusToBoardStatus[review.status],
      owner: "Abu Bakr",
      source: review.branch,
      labels: [review.status],
      comments: review.status === "Approved" ? 3 : 8,
      updated: run?.started ?? "Earlier today",
      githubUrl: `https://github.com/coworker/web/pull/${review.number}`,
      lastComment: run?.result ?? "Pull request review is attached to a coworker run.",
      runId: run?.id,
    };
  });

  return [...issueItems, ...reviewItems];
}

function filterWorkItems(workItems: WorkItem[], query: string): WorkItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return workItems;
  }

  return workItems.filter((item) =>
    [
      item.number,
      item.title,
      item.status,
      item.owner,
      item.source,
      item.labels.join(" "),
      item.lastComment,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function groupWorkItems(workItems: WorkItem[]): Record<WorkItemStatus, WorkItem[]> {
  return {
    Backlog: workItems.filter((item) => item.status === "Backlog"),
    Ready: workItems.filter((item) => item.status === "Ready"),
    "In progress": workItems.filter((item) => item.status === "In progress"),
    "In review": workItems.filter((item) => item.status === "In review"),
    Done: workItems.filter((item) => item.status === "Done"),
  };
}

export default function ProjectWorkspace({
  project,
  issues,
  reviews,
  runs,
  hasIssueSync,
}: ProjectWorkspaceProps): ReactElement {
  const [view, setView] = useState<ProjectWorkspaceView>(hasIssueSync ? "board" : "table");
  const [query, setQuery] = useState("");
  const workItems = useMemo(() => getWorkItems(issues, reviews, runs), [issues, reviews, runs]);
  const filteredItems = useMemo(() => filterWorkItems(workItems, query), [workItems, query]);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(() => workItems[0] ?? null);
  const isCompactWorkspace = useMediaQuery("(max-width: 1360px)");
  const detailPanel = useResizable({
    defaultSize: 340,
    minSizePx: 300,
    maxSizePx: 460,
  });
  const activeCount = workItems.filter((item) => item.status !== "Done").length;
  const commentCount = workItems.reduce((total, item) => total + item.comments, 0);

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={4}>
            <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={2}>GitHub issues and pull requests</Heading>
                  <Text type="supporting" color="secondary" as="p">
                    {project.repo} work that can start a coworker run, collect GitHub comments, or
                    wait for human review.
                  </Text>
                </VStack>
              </StackItem>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Text type="supporting" hasTabularNumbers>
                  {activeCount} active / {commentCount} comments
                </Text>
                <TabList
                  value={view}
                  onChange={(nextView) => setView(nextView as ProjectWorkspaceView)}
                >
                  <Tab value="board" label="Board" />
                  <Tab value="table" label="Table" />
                </TabList>
              </HStack>
            </HStack>
            <TextInput
              label="Filter issues"
              isLabelHidden
              placeholder="Filter by issue, coworker, label, branch, comment, or status..."
              value={query}
              onChange={setQuery}
            />
            {!hasIssueSync ? (
              <HStack gap={2} vAlign="center">
                <Icon icon={ExclamationTriangleIcon} size="sm" color="secondary" />
                <Text type="supporting" color="secondary">
                  Issue sync is not enabled for this project. Pull request reviews still appear here
                  when Abu Bakr runs.
                </Text>
              </HStack>
            ) : null}
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0} style={workspaceContentStyle}>
          {view === "table" ? (
            <ProjectWorkTable
              workItems={filteredItems}
              selectedItemId={selectedItem?.id}
              onSelectItem={setSelectedItem}
              isCompact={isCompactWorkspace}
            />
          ) : (
            <ProjectWorkBoard
              workItems={filteredItems}
              selectedItemId={selectedItem?.id}
              onSelectItem={setSelectedItem}
            />
          )}
        </LayoutContent>
      }
      end={
        selectedItem && !isCompactWorkspace ? (
          <>
            <ResizeHandle resizable={detailPanel.props} isReversed isAlwaysVisible={false} />
            <WorkItemDetailPanel
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              resizable={detailPanel.props}
            />
          </>
        ) : undefined
      }
    />
  );
}

function ProjectWorkTable({
  workItems,
  selectedItemId,
  onSelectItem,
  isCompact = false,
}: WorkItemsProps): ReactElement {
  const [expandedGroups, setExpandedGroups] = useState<Set<WorkItemStatus>>(
    () => new Set(statusOrder),
  );
  const groupedItems = groupWorkItems(workItems);
  const activeColumns = isCompact ? compactColumns : columns;
  const activeColumnWidths = isCompact ? resolvedCompactColumnWidths : resolvedColumnWidths;

  function toggleGroup(status: WorkItemStatus): void {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  return (
    <Stack style={tableShellStyle}>
      <Table
        columns={activeColumns}
        density="balanced"
        dividers="rows"
        textOverflow="truncate"
        hasHover
      >
        <colgroup>
          {activeColumns.map((column) => (
            <col key={column.key} style={activeColumnWidths.columns.get(column.key)?.style} />
          ))}
        </colgroup>
        <tbody>
          {statusOrder.map((status) => {
            const itemsForStatus = groupedItems[status];
            const isExpanded = expandedGroups.has(status);

            if (itemsForStatus.length === 0) {
              return null;
            }

            return (
              <Fragment key={status}>
                <TableRow
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleGroup(status)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleGroup(status);
                    }
                  }}
                >
                  <TableCell colSpan={activeColumns.length} style={groupHeaderCell}>
                    <HStack gap={2} vAlign="center">
                      <Icon
                        icon={isExpanded ? ChevronDownIcon : ChevronRightIcon}
                        size="sm"
                        color="secondary"
                      />
                      <StatusDot variant={statusDotVariants[status]} label={status} />
                      <Text type="body" weight="bold">
                        {statusLabels[status]}
                      </Text>
                      <Badge variant="neutral" label={String(itemsForStatus.length)} />
                    </HStack>
                  </TableCell>
                </TableRow>
                {isExpanded
                  ? itemsForStatus.map((item) => (
                      <Fragment key={item.id}>
                        {isCompact ? (
                          <ProjectWorkCompactTableRow
                            item={item}
                            isSelected={item.id === selectedItemId}
                            onSelectItem={onSelectItem}
                          />
                        ) : (
                          <ProjectWorkTableRow
                            item={item}
                            isSelected={item.id === selectedItemId}
                            onSelectItem={onSelectItem}
                          />
                        )}
                      </Fragment>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </Stack>
  );
}

function ProjectWorkCompactTableRow({
  item,
  isSelected,
  onSelectItem,
}: {
  item: WorkItem;
  isSelected: boolean;
  onSelectItem: (item: WorkItem) => void;
}): ReactElement {
  return (
    <TableRow aria-selected={isSelected} onClick={() => onSelectItem(item)}>
      <TableCell>
        <Center axis="horizontal">
          <StatusDot variant={statusDotVariants[item.status]} label={item.status} />
        </Center>
      </TableCell>
      <TableCell>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Badge variant={kindBadgeVariants[item.kind]} label={item.kind} />
            <Text type="supporting" color="secondary" hasTabularNumbers>
              #{item.number}
            </Text>
            <Text type="body" maxLines={1}>
              {item.title}
            </Text>
          </HStack>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <HStack gap={1} vAlign="center">
              <Avatar name={item.owner} size="xsmall" />
              <Text type="supporting" maxLines={1}>
                {item.owner}
              </Text>
            </HStack>
            <HStack gap={1} vAlign="center">
              <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
              <Text type="supporting" hasTabularNumbers>
                {item.comments}
              </Text>
            </HStack>
            <Text type="supporting">{item.updated}</Text>
            {item.runId ? (
              <Link href={`/app/runs/${item.runId}`} isStandalone>
                Open run
              </Link>
            ) : null}
          </HStack>
          {item.labels.length > 0 ? (
            <HStack gap={1} wrap="wrap">
              {item.labels.map((label) => (
                <Badge key={label} variant="neutral" label={label} />
              ))}
            </HStack>
          ) : null}
        </VStack>
      </TableCell>
      <TableCell>
        <Button
          label="Open GitHub"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
          onClick={() => window.open(item.githubUrl, "_blank", "noopener,noreferrer")}
        />
      </TableCell>
    </TableRow>
  );
}

function ProjectWorkTableRow({
  item,
  isSelected,
  onSelectItem,
}: {
  item: WorkItem;
  isSelected: boolean;
  onSelectItem: (item: WorkItem) => void;
}): ReactElement {
  return (
    <TableRow aria-selected={isSelected} onClick={() => onSelectItem(item)}>
      <TableCell>
        <Center axis="horizontal">
          <StatusDot variant={statusDotVariants[item.status]} label={item.status} />
        </Center>
      </TableCell>
      <TableCell>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center">
            <Badge variant={kindBadgeVariants[item.kind]} label={item.kind} />
            <Text type="supporting" color="secondary" hasTabularNumbers>
              #{item.number}
            </Text>
            <Text type="body" maxLines={1}>
              {item.title}
            </Text>
          </HStack>
          <HStack gap={1} wrap="wrap">
            {item.labels.map((label) => (
              <Badge key={label} variant="neutral" label={label} />
            ))}
          </HStack>
        </VStack>
      </TableCell>
      <TableCell>
        <HStack gap={2} vAlign="center">
          <Avatar name={item.owner} size="xsmall" />
          <Text type="body" maxLines={1}>
            {item.owner}
          </Text>
        </HStack>
      </TableCell>
      <TableCell>
        <HStack gap={1} vAlign="center">
          <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
          <Text type="supporting" hasTabularNumbers>
            {item.comments}
          </Text>
        </HStack>
      </TableCell>
      <TableCell>
        <Text type="supporting">{item.updated}</Text>
      </TableCell>
      <TableCell>
        {item.runId ? (
          <Link href={`/app/runs/${item.runId}`} isStandalone>
            Open run
          </Link>
        ) : (
          <Text type="supporting" color="secondary">
            -
          </Text>
        )}
      </TableCell>
      <TableCell>
        <Button
          label="Open GitHub"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
          onClick={() => window.open(item.githubUrl, "_blank", "noopener,noreferrer")}
        />
      </TableCell>
    </TableRow>
  );
}

function ProjectWorkBoard({
  workItems,
  selectedItemId,
  onSelectItem,
}: WorkItemsProps): ReactElement {
  const groupedItems = groupWorkItems(workItems);

  return (
    <HStack gap={4} style={boardShellStyle}>
      {statusOrder.map((status) => {
        const columnItems = groupedItems[status];

        return (
          <VStack key={status} gap={3} style={boardColumnStyle}>
            <HStack hAlign="between" vAlign="center">
              <HStack gap={2} vAlign="center">
                <StatusDot variant={statusDotVariants[status]} label={status} />
                <Text weight="semibold">{statusLabels[status]}</Text>
              </HStack>
              <Badge variant="neutral" label={String(columnItems.length)} />
            </HStack>
            <VStack gap={3}>
              {columnItems.length > 0 ? (
                columnItems.map((item) => (
                  <Card
                    key={item.id}
                    padding={4}
                    style={boardCardStyle}
                    variant={item.id === selectedItemId ? "muted" : undefined}
                    onClick={() => onSelectItem(item)}
                  >
                    <VStack gap={3}>
                      <HStack hAlign="between" vAlign="center">
                        <HStack gap={1} vAlign="center">
                          <Badge variant={kindBadgeVariants[item.kind]} label={item.kind} />
                          <Text type="supporting" hasTabularNumbers>
                            #{item.number}
                          </Text>
                        </HStack>
                        <HStack gap={1} vAlign="center">
                          <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
                          <Text type="supporting" hasTabularNumbers>
                            {item.comments}
                          </Text>
                        </HStack>
                      </HStack>
                      <Text weight="semibold" maxLines={2}>
                        {item.title}
                      </Text>
                      <Text type="supporting" color="secondary" maxLines={2}>
                        {item.lastComment}
                      </Text>
                      <Divider />
                      <HStack hAlign="between" vAlign="center">
                        <HStack gap={2} vAlign="center">
                          <Avatar name={item.owner} size="xsmall" />
                          <Text type="supporting" maxLines={1}>
                            {item.owner}
                          </Text>
                        </HStack>
                        <Text type="supporting">{item.updated}</Text>
                      </HStack>
                    </VStack>
                  </Card>
                ))
              ) : (
                <Card padding={4} variant="muted" style={boardCardStyle}>
                  <Text type="supporting" color="secondary">
                    No items
                  </Text>
                </Card>
              )}
            </VStack>
          </VStack>
        );
      })}
    </HStack>
  );
}

function WorkItemDetailPanel({ item, onClose, resizable }: WorkItemDetailPanelProps): ReactElement {
  const router = useRouter();

  return (
    <LayoutPanel
      hasDivider
      resizable={resizable}
      padding={4}
      role="complementary"
      label="Issue details"
    >
      <VStack gap={4}>
        <HStack hAlign="between" vAlign="center">
          <Badge variant={kindBadgeVariants[item.kind]} label={item.kind} />
          <Button label="Close" variant="ghost" size="sm" onClick={onClose} />
        </HStack>
        <VStack gap={1}>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            #{item.number}
          </Text>
          <Heading level={3}>{item.title}</Heading>
          <Text type="supporting" color="secondary">
            {item.source}
          </Text>
        </VStack>
        <MetadataList label={{ position: "start" }}>
          <MetadataListItem label="Status">
            <HStack gap={2} vAlign="center">
              <StatusDot variant={statusDotVariants[item.status]} label={item.status} />
              <Text>{item.status}</Text>
            </HStack>
          </MetadataListItem>
          <MetadataListItem label="Coworker">{item.owner}</MetadataListItem>
          <MetadataListItem label="Comments">{item.comments}</MetadataListItem>
          <MetadataListItem label="Updated">{item.updated}</MetadataListItem>
        </MetadataList>
        <Divider />
        <VStack gap={2}>
          <Text type="label">Latest comment</Text>
          <Text type="body" color="secondary" as="p">
            {item.lastComment}
          </Text>
        </VStack>
        <VStack gap={2}>
          <Text type="label">Labels</Text>
          <HStack gap={1} wrap="wrap">
            {item.labels.map((label) => (
              <Badge key={label} variant="neutral" label={label} />
            ))}
          </HStack>
        </VStack>
        <Divider />
        <HStack gap={2} wrap="wrap">
          <Button
            label="Open GitHub"
            variant="primary"
            size="md"
            icon={<Icon icon={ArrowTopRightOnSquareIcon} />}
            onClick={() => window.open(item.githubUrl, "_blank", "noopener,noreferrer")}
          />
          {item.runId ? (
            <Button
              label="Open run"
              variant="secondary"
              size="md"
              icon={<Icon icon={CodeBracketIcon} />}
              onClick={() => router.push(`/app/runs/${item.runId}`)}
            />
          ) : null}
        </HStack>
      </VStack>
    </LayoutPanel>
  );
}
