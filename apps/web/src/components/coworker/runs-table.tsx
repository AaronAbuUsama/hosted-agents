"use client";

import { Fragment, useMemo, useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Center } from "@astryxdesign/core/Center";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
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
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

import { coworkers, projects, runs, type Run, type RunStatus } from "@/lib/coworker-data";

type RunRow = Run & {
  coworkerName: string;
};

type RowsByStatus = Record<RunStatus, RunRow[]>;

const statusOrder: RunStatus[] = ["Running", "Needs review", "Blocked", "Completed"];

const statusDotVariants: Record<RunStatus, "accent" | "warning" | "success" | "error"> = {
  Running: "accent",
  "Needs review": "warning",
  Blocked: "error",
  Completed: "success",
};

const columns: TableColumn<RunRow>[] = [
  { key: "status", header: "", width: pixel(44) },
  { key: "title", header: "Run", width: proportional(1.6) },
  { key: "coworker", header: "Coworker", width: pixel(150) },
  { key: "project", header: "Project", width: pixel(180) },
  { key: "started", header: "Started", width: pixel(110) },
  { key: "duration", header: "Duration", width: pixel(90) },
  { key: "result", header: "Result", width: proportional(1) },
  { key: "actions", header: "", width: pixel(72) },
];

const compactColumns: TableColumn<RunRow>[] = [
  { key: "status", header: "", width: pixel(36) },
  { key: "title", header: "Run", width: proportional(1) },
  { key: "actions", header: "", width: pixel(64) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);
const resolvedCompactColumnWidths = resolveColumnWidths(compactColumns);

const groupHeaderCell: CSSProperties = {
  cursor: "pointer",
  backgroundColor: "var(--color-background-muted)",
  padding: "var(--spacing-3) var(--spacing-4)",
};

const interactiveRowStyle: CSSProperties = {
  cursor: "pointer",
};

const tableContentStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};

const coworkerNameById: Record<string, string> = Object.fromEntries(
  coworkers.map((coworker) => [coworker.id, coworker.name] as const),
);

const projectNameByRepo: Record<string, string> = Object.fromEntries(
  projects.map((project) => [project.repo, project.name] as const),
);

const rows: RunRow[] = runs.map((run) => ({
  ...run,
  coworkerName: coworkerNameById[run.coworkerId] ?? "Coworker",
}));

function groupRowsByStatus(runRows: RunRow[]): RowsByStatus {
  const grouped: RowsByStatus = {
    Running: [],
    "Needs review": [],
    Blocked: [],
    Completed: [],
  };

  for (const run of runRows) {
    grouped[run.status].push(run);
  }

  return grouped;
}

export default function RunsTable(): ReactElement {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<RunStatus>>(() => new Set(statusOrder));
  const isCompact = useMediaQuery("(max-width: 1360px)");

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter((run) =>
      [run.id, run.title, run.coworkerName, run.repo, run.branch, run.trigger, run.result]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search]);

  const groupedRows = useMemo(() => groupRowsByStatus(filteredRows), [filteredRows]);
  const activeColumns = isCompact ? compactColumns : columns;
  const activeColumnWidths = isCompact ? resolvedCompactColumnWidths : resolvedColumnWidths;

  function toggleGroup(status: RunStatus): void {
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
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={4}>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={1}>Runs</Heading>
                  <Text type="supporting" color="secondary">
                    Every coworker invocation across GitHub issues, pull requests, checks, and
                    sandboxed code changes.
                  </Text>
                </VStack>
              </StackItem>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {filteredRows.length} runs
              </Text>
            </HStack>
            <TextInput
              label="Filter runs"
              isLabelHidden
              placeholder="Filter by run, coworker, project, branch, trigger, or result..."
              value={search}
              onChange={setSearch}
            />
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" padding={0} style={tableContentStyle}>
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
                const runsForStatus = groupedRows[status];
                if (runsForStatus.length === 0) {
                  return null;
                }

                const isExpanded = expandedGroups.has(status);

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
                          <Text type="body" weight="bold">
                            {status}
                          </Text>
                          <Badge variant="neutral" label={String(runsForStatus.length)} />
                        </HStack>
                      </TableCell>
                    </TableRow>
                    {isExpanded
                      ? runsForStatus.map((run) => (
                          <RunTableRow
                            key={run.id}
                            run={run}
                            isCompact={isCompact}
                            onOpenRun={() => router.push(`/app/runs/${run.id}`)}
                          />
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </LayoutContent>
      }
    />
  );
}

type RunTableRowProps = {
  run: RunRow;
  isCompact: boolean;
  onOpenRun: () => void;
};

function RunTableRow({ run, isCompact, onOpenRun }: RunTableRowProps): ReactElement {
  return (
    <TableRow
      role="link"
      tabIndex={0}
      style={interactiveRowStyle}
      onClick={onOpenRun}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onOpenRun();
        }
      }}
    >
      <TableCell>
        <Center axis="horizontal">
          <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
        </Center>
      </TableCell>
      <TableCell>
        <RunPrimaryCell run={run} isCompact={isCompact} />
      </TableCell>
      {!isCompact ? (
        <>
          <TableCell>
            <HStack gap={2} vAlign="center">
              <Avatar name={run.coworkerName} size="xsmall" />
              <Text type="body" maxLines={1}>
                {run.coworkerName}
              </Text>
            </HStack>
          </TableCell>
          <TableCell>
            <VStack gap={1}>
              <Text type="body" maxLines={1}>
                {projectNameByRepo[run.repo] ?? run.repo}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {run.branch}
              </Text>
            </VStack>
          </TableCell>
          <TableCell>
            <Text type="supporting" color="secondary">
              {run.started}
            </Text>
          </TableCell>
          <TableCell>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {run.duration}
            </Text>
          </TableCell>
          <TableCell>
            <Text type="body" maxLines={1}>
              {run.result}
            </Text>
          </TableCell>
        </>
      ) : null}
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
  );
}

function RunPrimaryCell({ run, isCompact }: { run: RunRow; isCompact: boolean }): ReactElement {
  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Icon
          icon={run.status === "Blocked" ? ExclamationTriangleIcon : PlayCircleIcon}
          size="sm"
          color="secondary"
        />
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {run.id}
        </Text>
        <Text type="body" weight="semibold" maxLines={1}>
          {run.title}
        </Text>
      </HStack>
      <Text type="supporting" color="secondary" maxLines={1}>
        {run.trigger}
      </Text>
      {isCompact ? (
        <HStack gap={3} vAlign="center" wrap="wrap">
          <HStack gap={1} vAlign="center">
            <Avatar name={run.coworkerName} size="xsmall" />
            <Text type="supporting" maxLines={1}>
              {run.coworkerName}
            </Text>
          </HStack>
          <Text type="supporting" color="secondary" maxLines={1}>
            {projectNameByRepo[run.repo] ?? run.repo}
          </Text>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {run.started} / {run.duration}
          </Text>
          <Token label={run.status} />
        </HStack>
      ) : null}
    </VStack>
  );
}
