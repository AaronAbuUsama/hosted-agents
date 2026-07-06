"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
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
import { Token } from "@astryxdesign/core/Token";
import { ChatBubbleLeftRightIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import CoworkerPage from "@/components/coworker/coworker-page";
import {
  coworkers,
  projectIssues,
  projects,
  runs,
  setupSteps,
  type ProjectIssue,
  type Run,
  type SetupStep,
} from "@/lib/coworker-data";

type DashboardTab = "attention" | "activity" | "setup";

type DashboardItemKind = "Issue" | "Run" | "Setup";

type DashboardTone = "neutral" | "accent" | "warning" | "success" | "error";

type DashboardItem = {
  id: string;
  kind: DashboardItemKind;
  title: string;
  description: string;
  source: string;
  owner: string;
  updated: string;
  status: string;
  tone: DashboardTone;
  href: string;
  comments?: number;
};

const dashboardColumns: TableColumn<DashboardItem>[] = [
  { key: "state", header: "", width: pixel(44) },
  { key: "work", header: "Work", width: proportional(1.7) },
  { key: "source", header: "Source", width: pixel(144) },
  { key: "owner", header: "Owner", width: pixel(116) },
  { key: "activity", header: "Activity", width: pixel(108) },
  { key: "action", header: "", width: pixel(72) },
];

const compactDashboardColumns: TableColumn<DashboardItem>[] = [
  { key: "state", header: "", width: pixel(36) },
  { key: "work", header: "Work", width: proportional(1) },
  { key: "action", header: "", width: pixel(72) },
];

const dashboardColumnWidths = resolveColumnWidths(dashboardColumns);
const compactDashboardColumnWidths = resolveColumnWidths(compactDashboardColumns);

const pageBodyStyle: CSSProperties = {
  minWidth: 0,
};

const projectNameById = Object.fromEntries(
  projects.map((project) => [project.id, project.name] as const),
);

const coworkerNameById = Object.fromEntries(
  coworkers.map((coworker) => [coworker.id, coworker.name] as const),
);

const issueStatusTone: Record<ProjectIssue["status"], DashboardTone> = {
  Backlog: "neutral",
  Ready: "accent",
  "In progress": "warning",
  "In review": "warning",
  Done: "success",
};

const runStatusTone: Record<Run["status"], DashboardTone> = {
  Running: "accent",
  "Needs review": "warning",
  Completed: "success",
  Blocked: "error",
};

const setupStatusTone: Record<SetupStep["status"], DashboardTone> = {
  Complete: "success",
  "Needs attention": "warning",
  Partial: "warning",
  Drafting: "accent",
};

const setupHrefByTitle: Record<string, string> = {
  Organization: "/onboarding/organization",
  Repositories: "/onboarding/github",
  "Provider account": "/onboarding/provider",
  "GitHub Apps": "/onboarding/github",
};

function issueToDashboardItem(issue: ProjectIssue): DashboardItem {
  return {
    id: issue.id,
    kind: "Issue",
    title: `#${issue.number} ${issue.title}`,
    description: issue.lastComment,
    source: projectNameById[issue.projectId] ?? issue.projectId,
    owner: issue.assignee,
    updated: issue.updated,
    status: issue.status,
    tone: issueStatusTone[issue.status],
    href: `/app/projects/${issue.projectId}/issues/${issue.id}`,
    comments: issue.comments,
  };
}

function runToDashboardItem(run: Run): DashboardItem {
  return {
    id: run.id,
    kind: "Run",
    title: run.title,
    description: run.result,
    source: run.repo,
    owner: coworkerNameById[run.coworkerId] ?? "Coworker",
    updated: run.started,
    status: run.status,
    tone: runStatusTone[run.status],
    href: `/app/runs/${run.id}`,
  };
}

function setupToDashboardItem(step: SetupStep): DashboardItem {
  return {
    id: `setup-${step.title.toLowerCase().replaceAll(" ", "-")}`,
    kind: "Setup",
    title: step.title,
    description: step.detail,
    source: "Workspace setup",
    owner: "Admin",
    updated: step.status,
    status: step.status,
    tone: setupStatusTone[step.status],
    href:
      setupHrefByTitle[step.title] ??
      `/app/settings?section=${step.title.toLowerCase().replaceAll(" ", "-")}`,
  };
}

export default function AppOverviewPage(): ReactElement {
  const [activeTab, setActiveTab] = useState<DashboardTab>("attention");
  const isCompact = useMediaQuery("(max-width: 1280px)");
  const activeRuns = runs.filter(
    (run) => run.status === "Running" || run.status === "Needs review",
  );
  const attentionItems = [
    ...setupSteps.filter((step) => step.status !== "Complete").map(setupToDashboardItem),
    ...activeRuns.map(runToDashboardItem),
    ...projectIssues.filter((issue) => issue.status !== "Done").map(issueToDashboardItem),
  ];
  const activityItems = [
    ...activeRuns.map(runToDashboardItem),
    ...projectIssues.filter((issue) => issue.status !== "Done").map(issueToDashboardItem),
  ];
  const setupItems = setupSteps.map(setupToDashboardItem);
  const activeItems =
    activeTab === "attention"
      ? attentionItems
      : activeTab === "activity"
        ? activityItems
        : setupItems;
  const activeColumns = isCompact ? compactDashboardColumns : dashboardColumns;
  const activeColumnWidths = isCompact ? compactDashboardColumnWidths : dashboardColumnWidths;
  const attentionCount = attentionItems.length;

  return (
    <CoworkerPage
      variant="workspace"
      width="full"
      title="Workspace"
      description="Review what needs attention, inspect active coworker runs, and keep GitHub setup moving."
      actions={
        <HStack gap={3} vAlign="center" wrap="wrap">
          <HStack gap={1} vAlign="center">
            <StatusDot variant={attentionCount > 0 ? "warning" : "success"} label="Attention" />
            <Text type="supporting" hasTabularNumbers>
              {attentionCount} needs attention
            </Text>
          </HStack>
          <HStack gap={1} vAlign="center">
            <StatusDot variant={activeRuns.length > 0 ? "accent" : "neutral"} label="Runs" />
            <Text type="supporting" hasTabularNumbers>
              {activeRuns.length} active runs
            </Text>
          </HStack>
        </HStack>
      }
    >
      <VStack height="100%" isScrollable padding={4} gap={4} style={pageBodyStyle}>
        <Section variant="section" padding={0}>
          <VStack gap={0}>
            <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap" padding={4}>
              <VStack gap={1}>
                <Heading level={2}>{tabTitle(activeTab)}</Heading>
                <Text type="supporting" color="secondary">
                  {tabDescription(activeTab)}
                </Text>
              </VStack>
              <TabList value={activeTab} onChange={(value) => setActiveTab(value as DashboardTab)}>
                <Tab value="attention" label="Attention" />
                <Tab value="activity" label="Activity" />
                <Tab value="setup" label="Setup" />
              </TabList>
            </HStack>
            <DashboardTable
              columns={activeColumns}
              columnWidths={activeColumnWidths}
              isCompact={isCompact}
              items={activeItems}
            />
          </VStack>
        </Section>
      </VStack>
    </CoworkerPage>
  );
}

function tabTitle(tab: DashboardTab): string {
  if (tab === "activity") {
    return "Recent activity";
  }
  if (tab === "setup") {
    return "Setup";
  }
  return "Needs attention";
}

function tabDescription(tab: DashboardTab): string {
  if (tab === "activity") {
    return "Active runs and GitHub work that changed recently.";
  }
  if (tab === "setup") {
    return "Workspace setup items that control what coworkers can do.";
  }
  return "The queue of setup gaps, active runs, and GitHub work that needs a human decision.";
}

function DashboardTable({
  columns,
  columnWidths,
  isCompact,
  items,
}: {
  columns: TableColumn<DashboardItem>[];
  columnWidths: ReturnType<typeof resolveColumnWidths<DashboardItem>>;
  isCompact: boolean;
  items: DashboardItem[];
}): ReactElement {
  return (
    <Table columns={columns} density="compact" dividers="rows" textOverflow="truncate" hasHover>
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={columnWidths.columns.get(column.key)?.style} />
        ))}
      </colgroup>
      <tbody>
        {items.map((item) => (
          <DashboardTableRow key={item.id} item={item} isCompact={isCompact} />
        ))}
      </tbody>
    </Table>
  );
}

function DashboardTableRow({
  item,
  isCompact,
}: {
  item: DashboardItem;
  isCompact: boolean;
}): ReactElement {
  return (
    <TableRow>
      <TableCell>
        <StatusDot variant={item.tone} label={item.status} />
      </TableCell>
      <TableCell>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Token label={item.kind} />
            <Link href={item.href} isStandalone>
              {item.title}
            </Link>
          </HStack>
          <Text type="supporting" color="secondary" maxLines={1}>
            {item.description}
          </Text>
          {isCompact ? (
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Text type="supporting" color="secondary">
                {item.source}
              </Text>
              <Text type="supporting">{item.owner}</Text>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {item.updated}
              </Text>
              {item.comments != null ? (
                <HStack gap={1} vAlign="center">
                  <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
                  <Text type="supporting" hasTabularNumbers>
                    {item.comments}
                  </Text>
                </HStack>
              ) : null}
            </HStack>
          ) : null}
        </VStack>
      </TableCell>
      {!isCompact ? (
        <>
          <TableCell>
            <Text type="body" maxLines={1}>
              {item.source}
            </Text>
          </TableCell>
          <TableCell>
            <OwnerCell item={item} />
          </TableCell>
          <TableCell>
            <ActivityCell item={item} />
          </TableCell>
        </>
      ) : null}
      <TableCell>
        <Link href={item.href} isStandalone>
          Open
        </Link>
      </TableCell>
    </TableRow>
  );
}

function OwnerCell({ item }: { item: DashboardItem }): ReactElement {
  if (item.owner === "Admin") {
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={ExclamationTriangleIcon} size="sm" color="secondary" />
        <Text type="body">Admin</Text>
      </HStack>
    );
  }

  return (
    <HStack gap={2} vAlign="center">
      <Avatar name={item.owner} size="xsmall" />
      <Text type="body" maxLines={1}>
        {item.owner}
      </Text>
    </HStack>
  );
}

function ActivityCell({ item }: { item: DashboardItem }): ReactElement {
  if (item.comments != null) {
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={ChatBubbleLeftRightIcon} size="sm" color="secondary" />
        <Text type="supporting" hasTabularNumbers>
          {item.comments}
        </Text>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {item.updated}
        </Text>
      </HStack>
    );
  }

  return (
    <Text type="supporting" color="secondary" hasTabularNumbers>
      {item.updated}
    </Text>
  );
}
