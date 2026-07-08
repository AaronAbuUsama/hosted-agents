"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import {
  PowerSearch,
  usePowerSearchConfig,
  type PowerSearchFilter,
} from "@astryxdesign/core/PowerSearch";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import {
  Table,
  TableCell,
  TableHeaderCell,
  TableRow,
  pixel,
  proportional,
  resolveColumnWidths,
} from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token, type TokenProps } from "@astryxdesign/core/Token";
import { ExclamationTriangleIcon, PlayCircleIcon } from "@heroicons/react/24/outline";
import { useLiveQuery } from "@tanstack/react-db";
import { useRouter } from "next/navigation";

import { agentRunsCollection } from "@/lib/collections/agent-runs";
import { shortModelLabel, type RunViewModelRow, type RunViewModelStatus } from "@/lib/run-view-model";

const statusDotVariants: Record<RunViewModelStatus, "accent" | "warning" | "success" | "error"> = {
  Queued: "accent",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

const statusFilterValues = [
  { value: "Queued", label: "Queued" },
  { value: "Running", label: "Running" },
  { value: "Completed", label: "Completed" },
  { value: "Failed", label: "Failed" },
];

const columns: TableColumn<RunViewModelRow>[] = [
  { key: "status", header: "", width: pixel(36) },
  { key: "run", header: "Run", width: proportional(2.4) },
  { key: "worker", header: "Worker", width: pixel(120) },
  { key: "repo", header: "Repository", width: proportional(1.4) },
  { key: "result", header: "Result", width: proportional(2) },
  { key: "model", header: "Model", width: pixel(92) },
  { key: "started", header: "Started", width: pixel(120) },
  { key: "duration", header: "Duration", width: pixel(78) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);

const interactiveRowStyle: CSSProperties = { cursor: "pointer" };
const tableContentStyle: CSSProperties = { minWidth: 0, overflow: "hidden" };

function distinct(values: (string | null | undefined)[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value) {
      seen.add(value);
    }
  }
  return [...seen].sort().map((value) => ({ value, label: value }));
}

export default function RunsTable(): ReactElement {
  const router = useRouter();
  const [filters, setFilters] = useState<PowerSearchFilter[]>([]);
  const { data: rows, isError, isLoading } = useLiveQuery(agentRunsCollection);

  const fieldDefs = useMemo(
    () =>
      [
        { key: "title", type: "string", label: "Run" },
        { key: "status", type: "enum", label: "Status", enumValues: statusFilterValues },
        { key: "coworkerName", type: "enum", label: "Worker", enumValues: distinct(rows.map((r) => r.coworkerName)) },
        { key: "repo", type: "enum", label: "Repository", enumValues: distinct(rows.map((r) => r.repo)) },
        { key: "result", type: "string", label: "Result" },
      ] as const,
    [rows],
  );

  const { config, applyFilters } = usePowerSearchConfig(fieldDefs, "Runs");
  const searchConfig = useMemo(() => ({ ...config, contentSearchFieldKey: "title" }), [config]);
  const filtered = useMemo(() => applyFilters(filters, rows), [filters, applyFilters, rows]);

  const hasLoaded = !isError && !isLoading;
  const hasNoRows = hasLoaded && rows.length === 0;

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <VStack gap={1}>
                <Heading level={1}>Runs</Heading>
                <Text type="supporting" color="secondary">
                  Every worker invocation across pull requests, checks, and sandboxed changes.
                </Text>
              </VStack>
            </StackItem>
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" isScrollable padding={0} style={tableContentStyle}>
          {isError ? (
            <PaddedState>
              <Banner
                status="error"
                title="Runs could not load"
                description="The server did not return agent runs for this session. Check that the local API is running and the browser has an active organization session."
                container="section"
              />
            </PaddedState>
          ) : isLoading && rows.length === 0 ? (
            <PaddedState>
              <Center>
                <Text type="supporting" color="secondary">
                  Loading runs…
                </Text>
              </Center>
            </PaddedState>
          ) : hasNoRows ? (
            <PaddedState>
              <EmptyState
                title="No runs yet"
                description="Pull request reviews and worker runs appear here once a webhook or a manual request creates them."
                headingLevel={2}
              />
            </PaddedState>
          ) : (
            <VStack gap={0} height="fill">
              <VStack padding={4}>
                <PowerSearch
                  config={searchConfig}
                  filters={filters}
                  onChange={(next) => setFilters([...next])}
                  placeholder="Search runs, or filter by status, worker, or repository…"
                  resultCount={filtered.length}
                />
              </VStack>
              <StackItem size="fill" style={tableContentStyle}>
                <Table
                  columns={columns}
                  density="balanced"
                  dividers="rows"
                  textOverflow="truncate"
                  hasHover
                >
                  <colgroup>
                    {columns.map((column) => (
                      <col
                        key={column.key}
                        style={resolvedColumnWidths.columns.get(column.key)?.style}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <TableRow>
                      {columns.map((column) => (
                        <TableHeaderCell key={column.key}>{column.header}</TableHeaderCell>
                      ))}
                    </TableRow>
                  </thead>
                  <tbody>
                    {filtered.map((run) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        onOpen={() => router.push(`/app/runs/${run.id}`)}
                      />
                    ))}
                  </tbody>
                </Table>
              </StackItem>
            </VStack>
          )}
        </LayoutContent>
      }
    />
  );
}

function PaddedState({ children }: { children: ReactElement }): ReactElement {
  return <VStack padding={4}>{children}</VStack>;
}

function RunRow({ run, onOpen }: { run: RunViewModelRow; onOpen: () => void }): ReactElement {
  const model = shortModelLabel(run.model);

  return (
    <TableRow
      role="link"
      tabIndex={0}
      style={interactiveRowStyle}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onOpen();
        }
      }}
    >
      <TableCell>
        <Center axis="horizontal">
          <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
        </Center>
      </TableCell>
      <TableCell>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Icon
              icon={run.status === "Failed" ? ExclamationTriangleIcon : PlayCircleIcon}
              size="sm"
              color="secondary"
            />
            <Text type="body" weight="semibold" maxLines={1}>
              {run.title}
            </Text>
          </HStack>
          <Text type="supporting" color="secondary" maxLines={1}>
            {run.trigger}
          </Text>
        </VStack>
      </TableCell>
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
        <VStack gap={1}>
          {run.status === "Completed" ? <RunFindingsToken run={run} /> : null}
          <Text
            type={run.status === "Completed" ? "supporting" : "body"}
            color={run.status === "Completed" ? "secondary" : undefined}
            maxLines={2}
          >
            {run.result}
          </Text>
        </VStack>
      </TableCell>
      <TableCell>
        <Text type="supporting" color="secondary" maxLines={1}>
          {model ?? "—"}
        </Text>
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
    </TableRow>
  );
}

function RunFindingsToken({ run }: { run: RunViewModelRow }): ReactElement {
  const count = run.findings.length;
  if (count === 0) {
    return <Token label="No findings" color="green" size="sm" />;
  }

  const hasHighSeverity = run.findings.some((finding) => finding.severity === "high");
  const color: TokenProps["color"] = hasHighSeverity ? "red" : "orange";
  return <Token label={`${count} finding${count === 1 ? "" : "s"}`} color={color} size="sm" />;
}
