"use client";

import { Fragment, useMemo, useState, type CSSProperties, type ReactElement } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
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
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

import { coworkers, projects, runs, type Run, type RunStatus } from "@/lib/coworker-data";

type RunRow = Run & {
  coworkerName: string;
};

type RunDetailPanelProps = {
  run: RunRow;
  onClose: () => void;
  resizable: ResizableProps;
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
  { key: "title", header: "Run", width: proportional(1) },
  { key: "coworker", header: "Coworker", width: pixel(150) },
  { key: "project", header: "Project", width: pixel(180) },
  { key: "started", header: "Started", width: pixel(110) },
  { key: "duration", header: "Duration", width: pixel(90) },
  { key: "result", header: "Result", width: proportional(1) },
  { key: "actions", header: "", width: pixel(56) },
];

const groupHeaderCell: CSSProperties = {
  cursor: "pointer",
  backgroundColor: "var(--color-background-muted)",
  padding: "var(--spacing-3) var(--spacing-4)",
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

const resolvedColumnWidths = resolveColumnWidths(columns);

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
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(() => rows[0] ?? null);
  const [expandedGroups, setExpandedGroups] = useState<Set<RunStatus>>(() => new Set(statusOrder));
  const detailPanel = useResizable({ defaultSize: 360, minSizePx: 280, maxSizePx: 500 });

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
            <HStack gap={3} vAlign="center">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={1}>Runs</Heading>
                  <Text type="supporting" color="secondary">
                    Every coworker invocation across GitHub issues, pull requests, checks, and
                    sandboxed code changes.
                  </Text>
                </VStack>
              </StackItem>
              <Button label="Kick off run" variant="primary" size="lg" />
            </HStack>
            <TextInput
              label="Filter runs"
              isLabelHidden
              placeholder="Filter by run, coworker, project, branch, trigger, or result…"
              value={search}
              onChange={setSearch}
            />
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" padding={0}>
          <Table
            columns={columns}
            density="balanced"
            dividers="rows"
            textOverflow="truncate"
            hasHover
          >
            <colgroup>
              {columns.map((column) => (
                <col key={column.key} style={resolvedColumnWidths.columns.get(column.key)?.style} />
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
                      <TableCell colSpan={columns.length} style={groupHeaderCell}>
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
                    {isExpanded &&
                      runsForStatus.map((run) => (
                        <TableRow key={run.id} onClick={() => setSelectedRun(run)}>
                          <TableCell>
                            <Center axis="horizontal">
                              <StatusDot
                                variant={statusDotVariants[run.status]}
                                label={run.status}
                              />
                            </Center>
                          </TableCell>
                          <TableCell>
                            <HStack gap={3} vAlign="center">
                              <Icon
                                icon={
                                  run.status === "Blocked"
                                    ? ExclamationTriangleIcon
                                    : PlayCircleIcon
                                }
                                size="sm"
                                color="secondary"
                              />
                              <Text type="supporting" color="secondary">
                                {run.id}
                              </Text>
                              <Text type="body" maxLines={1}>
                                {run.title}
                              </Text>
                              <Text type="body" color="secondary" maxLines={1}>
                                › {run.trigger}
                              </Text>
                            </HStack>
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
                            <Text type="body" maxLines={1}>
                              {projectNameByRepo[run.repo] ?? run.repo}
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
                          <TableCell>
                            <Text type="body" maxLines={1}>
                              {run.result}
                            </Text>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu
                              button={{
                                label: "Actions",
                                variant: "ghost",
                                size: "sm",
                                icon: <Icon icon={EllipsisHorizontalIcon} size="sm" />,
                                isIconOnly: true,
                              }}
                              hasChevron={false}
                              items={[
                                {
                                  label: "Open run",
                                  icon: ArrowTopRightOnSquareIcon,
                                  onClick: () => router.push(`/app/runs/${run.id}`),
                                },
                                {
                                  label: "Open in GitHub",
                                  icon: ArrowTopRightOnSquareIcon,
                                  onClick: () => {},
                                },
                                { type: "divider" as const },
                                {
                                  label: "Cancel run",
                                  icon: ExclamationTriangleIcon,
                                  onClick: () => {},
                                },
                              ]}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </LayoutContent>
      }
      end={
        selectedRun && (
          <>
            <ResizeHandle resizable={detailPanel.props} isReversed isAlwaysVisible={false} />
            <RunDetailPanel
              run={selectedRun}
              onClose={() => setSelectedRun(null)}
              resizable={detailPanel.props}
            />
          </>
        )
      }
    />
  );
}

function RunDetailPanel({ run, onClose, resizable }: RunDetailPanelProps): ReactElement {
  const router = useRouter();

  return (
    <LayoutPanel
      hasDivider
      resizable={resizable}
      padding={4}
      role="complementary"
      label="Run details"
    >
      <VStack gap={4}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Text type="supporting" color="secondary">
              {run.id}
            </Text>
          </StackItem>
          <Button label="Close panel" variant="ghost" size="sm" onClick={onClose} />
        </HStack>

        <VStack gap={1}>
          <Heading level={3}>{run.title}</Heading>
          <Text type="body" color="secondary">
            {run.result}
          </Text>
        </VStack>

        <MetadataList label={{ position: "start" }}>
          <MetadataListItem label="Status">
            <HStack gap={2} vAlign="center">
              <StatusDot variant={statusDotVariants[run.status]} label={run.status} />
              <Text type="body">{run.status}</Text>
            </HStack>
          </MetadataListItem>
          <MetadataListItem label="Coworker">
            <HStack gap={2} vAlign="center">
              <Avatar name={run.coworkerName} size="xsmall" />
              <Text type="body">{run.coworkerName}</Text>
            </HStack>
          </MetadataListItem>
          <MetadataListItem label="Project">
            {projectNameByRepo[run.repo] ?? run.repo}
          </MetadataListItem>
          <MetadataListItem label="Branch">{run.branch}</MetadataListItem>
          <MetadataListItem label="Trigger">{run.trigger}</MetadataListItem>
          <MetadataListItem label="Started">{run.started}</MetadataListItem>
          <MetadataListItem label="Duration">{run.duration}</MetadataListItem>
        </MetadataList>

        <Divider />

        <HStack gap={2}>
          <Button
            label="Open run"
            variant="primary"
            size="md"
            onClick={() => router.push(`/app/runs/${run.id}`)}
          />
          <Button label="Open GitHub" variant="secondary" size="md" />
        </HStack>
      </VStack>
    </LayoutPanel>
  );
}
