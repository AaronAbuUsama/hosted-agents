"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
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
import { Heading, Text } from "@astryxdesign/core/Text";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import {
  coworkers,
  projectIssues,
  projects,
  runs,
  setupSteps,
  setupStepStatusBadgeVariants,
  summaryRunStatusBadgeVariants,
  type ProjectIssue,
  type Run,
} from "@/lib/coworker-data";

type IssueRow = ProjectIssue & {
  projectName: string;
};

type RunRow = Run & {
  coworkerName: string;
};

const issueColumns: TableColumn<IssueRow>[] = [
  { key: "issue", header: "Issue", width: proportional(1) },
  { key: "status", header: "Status", width: pixel(132) },
  { key: "owner", header: "Coworker", width: pixel(140) },
  { key: "comments", header: "Comments", width: pixel(112) },
  { key: "updated", header: "Updated", width: pixel(110) },
];

const runColumns: TableColumn<RunRow>[] = [
  { key: "run", header: "Run", width: proportional(1) },
  { key: "coworker", header: "Coworker", width: pixel(140) },
  { key: "status", header: "Status", width: pixel(132) },
  { key: "duration", header: "Duration", width: pixel(92) },
];

const issueColumnWidths = resolveColumnWidths(issueColumns);
const runColumnWidths = resolveColumnWidths(runColumns);

const issueStatusVariant: Record<
  ProjectIssue["status"],
  "neutral" | "accent" | "warning" | "success"
> = {
  Backlog: "neutral",
  Ready: "accent",
  "In progress": "warning",
  "In review": "warning",
  Done: "success",
};

const coworkerNameById = Object.fromEntries(
  coworkers.map((coworker) => [coworker.id, coworker.name] as const),
);
const projectNameById = Object.fromEntries(
  projects.map((project) => [project.id, project.name] as const),
);

export default function AppOverviewPage(): ReactElement {
  const activeRuns = runs.filter(
    (run) => run.status === "Running" || run.status === "Needs review",
  );
  const reviewQueue = projectIssues.filter((issue) => issue.status !== "Done");
  const issueRows = reviewQueue.map((issue) => ({
    ...issue,
    projectName: projectNameById[issue.projectId] ?? issue.projectId,
  }));
  const runRows = activeRuns.map((run) => ({
    ...run,
    coworkerName: coworkerNameById[run.coworkerId] ?? "Coworker",
  }));
  const openPullRequests = projects.reduce((total, project) => total + project.openPullRequests, 0);

  return (
    <CoworkerPage
      width="full"
      title="Workspace"
      description="Kick off named coworkers, watch GitHub issues, and inspect the runs that are producing comments, checks, and pull requests."
    >
      <HStack gap={3} wrap="wrap">
        <MetricCard label="Linked projects" value={projects.length} />
        <MetricCard label="Open pull requests" value={openPullRequests} />
        <MetricCard label="Active runs" value={activeRuns.length} />
        <MetricCard label="Issues needing attention" value={reviewQueue.length} />
      </HStack>

      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center">
          <VStack gap={1}>
            <Heading level={2}>GitHub issues</Heading>
            <Text type="supporting" color="secondary">
              Issues with comments, assigned coworkers, and linked runs.
            </Text>
          </VStack>
          <Link href="/app/projects/coworker-web" isStandalone>
            Open board
          </Link>
        </HStack>
        <Table
          columns={issueColumns}
          density="balanced"
          dividers="rows"
          textOverflow="truncate"
          hasHover
        >
          <colgroup>
            {issueColumns.map((column) => (
              <col key={column.key} style={issueColumnWidths.columns.get(column.key)?.style} />
            ))}
          </colgroup>
          <tbody>
            {issueRows.map((issue) => (
              <TableRow key={issue.id}>
                <TableCell>
                  <VStack gap={1}>
                    <HStack gap={2} vAlign="center">
                      <Text type="supporting" color="secondary" hasTabularNumbers>
                        #{issue.number}
                      </Text>
                      <Link href={`/app/projects/${issue.projectId}`} isStandalone>
                        {issue.title}
                      </Link>
                    </HStack>
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {issue.projectName} / {issue.lastComment}
                    </Text>
                  </VStack>
                </TableCell>
                <TableCell>
                  <HStack gap={2} vAlign="center">
                    <StatusDot variant={issueStatusVariant[issue.status]} label={issue.status} />
                    <Text type="body">{issue.status}</Text>
                  </HStack>
                </TableCell>
                <TableCell>
                  <HStack gap={2} vAlign="center">
                    <Avatar name={issue.assignee} size="xsmall" />
                    <Text type="body" maxLines={1}>
                      {issue.assignee}
                    </Text>
                  </HStack>
                </TableCell>
                <TableCell>
                  <HStack gap={1} vAlign="center">
                    <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
                    <Text type="supporting" hasTabularNumbers>
                      {issue.comments}
                    </Text>
                  </HStack>
                </TableCell>
                <TableCell>
                  <Text type="supporting">{issue.updated}</Text>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </VStack>

      <HStack gap={5} vAlign="start">
        <StackItem size="fill">
          <VStack gap={3}>
            <HStack hAlign="between" vAlign="center">
              <VStack gap={1}>
                <Heading level={2}>Active runs</Heading>
                <Text type="supporting" color="secondary">
                  What coworkers are doing right now.
                </Text>
              </VStack>
              <Link href="/app/runs" isStandalone>
                View all runs
              </Link>
            </HStack>
            <Table
              columns={runColumns}
              density="balanced"
              dividers="rows"
              textOverflow="truncate"
              hasHover
            >
              <colgroup>
                {runColumns.map((column) => (
                  <col key={column.key} style={runColumnWidths.columns.get(column.key)?.style} />
                ))}
              </colgroup>
              <tbody>
                {runRows.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <VStack gap={1}>
                        <Link href={`/app/runs/${run.id}`} isStandalone>
                          {run.title}
                        </Link>
                        <Text type="supporting" color="secondary" maxLines={1}>
                          {run.repo} / {run.trigger}
                        </Text>
                      </VStack>
                    </TableCell>
                    <TableCell>
                      <HStack gap={2} vAlign="center">
                        <Avatar name={run.coworkerName} size="xsmall" />
                        <Text>{run.coworkerName}</Text>
                      </HStack>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={summaryRunStatusBadgeVariants[run.status]}
                        label={run.status}
                      />
                    </TableCell>
                    <TableCell>
                      <Text type="supporting" hasTabularNumbers>
                        {run.duration}
                      </Text>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </VStack>
        </StackItem>
        <VStack gap={3}>
          <Heading level={2}>Setup health</Heading>
          {setupSteps.map((step) => (
            <Card key={step.title} padding={4}>
              <VStack gap={2}>
                <HStack hAlign="between" gap={3}>
                  <Text weight="semibold">{step.title}</Text>
                  <Badge variant={setupStepStatusBadgeVariants[step.status]} label={step.status} />
                </HStack>
                <Text type="supporting" color="secondary" as="p">
                  {step.detail}
                </Text>
              </VStack>
            </Card>
          ))}
        </VStack>
      </HStack>
    </CoworkerPage>
  );
}

function MetricCard({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <Card padding={4}>
      <VStack gap={1}>
        <Text type="label" color="secondary">
          {label}
        </Text>
        <Text type="display-3" hasTabularNumbers>
          {value}
        </Text>
      </VStack>
    </Card>
  );
}
