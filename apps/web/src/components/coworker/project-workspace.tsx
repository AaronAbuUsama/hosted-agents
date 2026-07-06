"use client";

import { useState, type ReactElement } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, TableCell, TableRow, pixel, proportional, resolveColumnWidths } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";

import type { ProjectIssue, PullRequestReview, Run } from "@/lib/coworker-data";

type ProjectWorkspaceProps = {
  issues: ProjectIssue[];
  reviews: PullRequestReview[];
  runs: Run[];
  hasIssueSync: boolean;
};

type ProjectWorkspaceView = "table" | "board";

type WorkItemKind = "Issue" | "Pull request";

type WorkItemStatus = "Backlog" | "Ready" | "In progress" | "In review" | "Done";

type WorkItem = {
  id: string;
  kind: WorkItemKind;
  number: number;
  title: string;
  status: WorkItemStatus;
  owner: string;
  branch: string;
  labels: string[];
  runId?: string;
};

type WorkItemsProps = {
  workItems: WorkItem[];
};

type ProjectWorkContentProps = WorkItemsProps & {
  view: ProjectWorkspaceView;
};

const columns: TableColumn<WorkItem>[] = [
  { key: "item", header: "Item", width: proportional(1) },
  { key: "status", header: "Status", width: pixel(132) },
  { key: "owner", header: "Coworker", width: pixel(128) },
  { key: "source", header: "Source", width: pixel(220) },
  { key: "run", header: "Run", width: pixel(112) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);

const boardStatuses: WorkItemStatus[] = ["Backlog", "Ready", "In progress", "In review", "Done"];

const statusBadgeVariants: Record<WorkItemStatus, "green" | "neutral" | "yellow" | "blue"> = {
  Backlog: "neutral",
  Ready: "blue",
  "In progress": "yellow",
  "In review": "yellow",
  Done: "green",
};

const kindBadgeVariants: Record<WorkItemKind, "blue" | "neutral"> = {
  Issue: "neutral",
  "Pull request": "blue",
};

const kindDotClasses: Record<WorkItemKind, string> = {
  Issue: "bg-muted-foreground",
  "Pull request": "bg-chart-2",
};

const reviewStatusToBoardStatus: Record<PullRequestReview["status"], WorkItemStatus> = {
  Reviewing: "In review",
  "Waiting for CI": "In review",
  Approved: "Done",
};

function getWorkItems(issues: ProjectIssue[], reviews: PullRequestReview[], runs: Run[]): WorkItem[] {
  const issueItems = issues.map((issue): WorkItem => ({
    id: issue.id,
    kind: "Issue",
    number: issue.number,
    title: issue.title,
    status: issue.status,
    owner: issue.assignee,
    branch: "GitHub issue sync",
    labels: issue.labels,
    runId: issue.linkedRunId,
  }));

  const reviewItems = reviews.map((review): WorkItem => ({
    id: review.id,
    kind: "Pull request",
    number: review.number,
    title: review.title,
    status: reviewStatusToBoardStatus[review.status],
    owner: "Abu Bakr",
    branch: review.branch,
    labels: [review.status],
    runId: runs.find((run) => run.branch === review.branch)?.id,
  }));

  return [...issueItems, ...reviewItems];
}

function ProjectWorkContent({ view, workItems }: ProjectWorkContentProps): ReactElement {
  if (workItems.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-5">
        <Text type="supporting">No issues or pull requests are currently tracked for this project.</Text>
      </div>
    );
  }

  if (view === "table") {
    return <ProjectWorkTable workItems={workItems} />;
  }

  return <ProjectWorkBoard workItems={workItems} />;
}

function ProjectWorkTable({ workItems }: WorkItemsProps): ReactElement {
  return (
    <Table columns={columns} density="balanced" dividers="rows" textOverflow="truncate" hasHover>
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={resolvedColumnWidths.columns.get(column.key)?.style} />
        ))}
      </colgroup>
      <tbody>
        {workItems.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <HStack gap={2} vAlign="start">
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${kindDotClasses[item.kind]}`} />
                <VStack gap={1}>
                  <HStack gap={1} wrap="wrap" vAlign="center">
                    <Text weight="semibold" hasTabularNumbers>
                      #{item.number}
                    </Text>
                    <Text>{item.title}</Text>
                  </HStack>
                  <HStack gap={1} wrap="wrap">
                    <Badge variant={kindBadgeVariants[item.kind]} label={item.kind} />
                    {item.labels.map((label) => (
                      <Badge key={label} variant="neutral" label={label} />
                    ))}
                  </HStack>
                </VStack>
              </HStack>
            </TableCell>
            <TableCell>
              <Badge variant={statusBadgeVariants[item.status]} label={item.status} />
            </TableCell>
            <TableCell>
              <Text type="supporting">{item.owner}</Text>
            </TableCell>
            <TableCell>
              <Text type="supporting" maxLines={1}>
                {item.branch}
              </Text>
            </TableCell>
            <TableCell>
              {item.runId ? (
                <Link href={`/app/runs/${item.runId}`} isStandalone>
                  Open run
                </Link>
              ) : (
                <Text type="supporting">—</Text>
              )}
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </Table>
  );
}

function ProjectWorkBoard({ workItems }: WorkItemsProps): ReactElement {
  return (
    <section className="grid gap-3 xl:grid-cols-5" aria-label="Project work board">
      {boardStatuses.map((status) => {
        const columnItems = workItems.filter((item) => item.status === status);

        return (
          <section key={status} className="rounded-lg border border-border bg-muted/20 p-3">
            <VStack gap={3}>
              <HStack hAlign="between" vAlign="center">
                <Text weight="semibold">{status}</Text>
                <Badge variant="neutral" label={columnItems.length} />
              </HStack>
              {columnItems.length > 0 ? (
                columnItems.map((item) => (
                  <article key={item.id} className="rounded-md border border-border bg-background p-3">
                    <VStack gap={2}>
                      <HStack gap={1} vAlign="center">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${kindDotClasses[item.kind]}`} />
                        <Badge variant={kindBadgeVariants[item.kind]} label={item.kind} />
                      </HStack>
                      <Text weight="semibold">
                        #{item.number} {item.title}
                      </Text>
                      <Text type="supporting">{item.owner}</Text>
                    </VStack>
                  </article>
                ))
              ) : (
                <Text type="supporting">No items</Text>
              )}
            </VStack>
          </section>
        );
      })}
    </section>
  );
}

export default function ProjectWorkspace({
  issues,
  reviews,
  runs,
  hasIssueSync,
}: ProjectWorkspaceProps): ReactElement {
  const [view, setView] = useState<ProjectWorkspaceView>("table");
  const workItems = getWorkItems(issues, reviews, runs);
  const activeCount = workItems.filter((item) => item.status !== "Done").length;
  const reviewCount = workItems.filter((item) => item.status === "In review").length;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="project-work-title">
      <div className="border-b border-border px-5 py-4">
        <HStack hAlign="between" vAlign="start">
          <VStack gap={1}>
            <Heading level={2} id="project-work-title">
              Project work
            </Heading>
            <Text type="supporting" as="p">
              Issues and pull requests stay in one workflow. Runs attach to the issue or pull request that started them.
            </Text>
          </VStack>
          <HStack gap={3} vAlign="center">
            <Text type="supporting" hasTabularNumbers>
              {activeCount} active · {reviewCount} in review
            </Text>
            <TabList value={view} onChange={(nextView) => setView(nextView as ProjectWorkspaceView)}>
              <Tab value="table" label="Table" />
              <Tab value="board" label="Board" />
            </TabList>
          </HStack>
        </HStack>
      </div>

      {!hasIssueSync && (
        <div className="border-b border-border bg-muted/30 px-5 py-3">
          <Text type="supporting" as="p">
            Issue sync is not enabled for this project. Pull requests still appear here when Abu Bakr reviews them.
          </Text>
        </div>
      )}

      <div className={view === "table" ? "" : "p-4"}>
        <ProjectWorkContent view={view} workItems={workItems} />
      </div>
    </section>
  );
}
