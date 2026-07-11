"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
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
import { ExclamationTriangleIcon, PlayCircleIcon } from "@heroicons/react/24/outline";
import { useLiveQuery } from "@tanstack/react-db";
import { useRouter } from "next/navigation";

import { agentRunsCollection } from "@/lib/collections/agent-runs";
import { filterRunsByRepository, sortRunRowsByRecency } from "@/lib/run-view-model";
import type { RunViewModelRow, RunViewModelStatus } from "@/lib/run-view-model";

const statusDotVariants: Record<RunViewModelStatus, "accent" | "warning" | "success" | "error"> = {
  Queued: "accent",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

// Flat audit list — no status grouping, no trailing "Open" link (the whole row
// navigates to the run workspace).
const columns: TableColumn<RunViewModelRow>[] = [
  { key: "status", header: "", width: pixel(44) },
  { key: "title", header: "Run", width: proportional(1.6) },
  { key: "coworker", header: "Coworker", width: pixel(150) },
  { key: "project", header: "Project", width: pixel(180) },
  { key: "started", header: "Started", width: pixel(110) },
  { key: "duration", header: "Duration", width: pixel(90) },
  { key: "result", header: "Result", width: proportional(1) },
];

const compactColumns: TableColumn<RunViewModelRow>[] = [
  { key: "status", header: "", width: pixel(36) },
  { key: "title", header: "Run", width: proportional(1) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);
const resolvedCompactColumnWidths = resolveColumnWidths(compactColumns);

const interactiveRowStyle: CSSProperties = {
  cursor: "pointer",
};

const tableContentStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
};

type RunsTableProps = {
  // When set, scope the table to a single repository by its "owner/name" label,
  // so a project's Runs tab shows only that project's runs. Absent on the global
  // Runs page, which lists every repository's runs.
  repoFilter?: string;
};

export default function RunsTable({ repoFilter }: RunsTableProps = {}): ReactElement {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const isCompact = useMediaQuery("(max-width: 1360px)");
  const { data: allRows, isError, isLoading } = useLiveQuery(agentRunsCollection);
  const rows = repoFilter ? filterRunsByRepository(allRows, repoFilter) : allRows;

  const query = search.trim().toLowerCase();
  const filteredRows = query
    ? rows.filter((run) =>
        [run.id, run.title, run.coworkerName, run.repo, run.branch, run.trigger, run.result]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : rows;
  const sortedRows = sortRunRowsByRecency(filteredRows);
  const hasLoadedRows = !isError && !isLoading;
  const hasNoRows = hasLoadedRows && rows.length === 0;
  const hasNoSearchResults = hasLoadedRows && rows.length > 0 && filteredRows.length === 0;
  const activeColumns = isCompact ? compactColumns : columns;
  const activeColumnWidths = isCompact ? resolvedCompactColumnWidths : resolvedColumnWidths;
  const showsPaddedState = isError || hasNoRows || hasNoSearchResults;

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
        <LayoutContent role="main" padding={showsPaddedState ? 4 : 0} style={tableContentStyle}>
          {isError ? (
            <Banner
              status="error"
              title="Runs could not load"
              description="The server did not return agent runs for this session. Check that the local API is running and that the browser has an active organization session."
              container="section"
            />
          ) : isLoading && rows.length === 0 ? (
            <Center>
              <Text type="supporting" color="secondary">
                Loading runs…
              </Text>
            </Center>
          ) : hasNoRows ? (
            <EmptyState
              title="No runs yet"
              description="Queued GitHub pull request reviews and worker runs will appear here after webhook admission creates agent_run records."
              headingLevel={2}
            />
          ) : hasNoSearchResults ? (
            <EmptyState
              title="No matching runs"
              description="Clear the filter or search by run id, coworker, repository, branch, trigger, or result."
              headingLevel={2}
            />
          ) : (
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
                {sortedRows.map((run) => (
                  <RunTableRow
                    key={run.id}
                    run={run}
                    isCompact={isCompact}
                    onOpenRun={() => router.push(`/app/runs/${run.id}`)}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </LayoutContent>
      }
    />
  );
}

type RunTableRowProps = {
  run: RunViewModelRow;
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
                {run.repo}
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
    </TableRow>
  );
}

function RunPrimaryCell({
  run,
  isCompact,
}: {
  run: RunViewModelRow;
  isCompact: boolean;
}): ReactElement {
  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Icon
          icon={run.status === "Failed" ? ExclamationTriangleIcon : PlayCircleIcon}
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
            {run.repo}
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
