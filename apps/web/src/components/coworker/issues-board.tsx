"use client";

import { Fragment, useState, type CSSProperties, type ReactElement } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, LayoutContent } from "@astryxdesign/core/Layout";
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
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { mapBoardLoadError } from "@/lib/board-load-error";
import { createKickOffHandlers } from "@/lib/issue-kickoff";
import { isLaneExpanded, toggleLaneCollapsed } from "@/lib/issues-board-lanes";
import { issuesRevisionPollInterval } from "@/lib/issues-revision-poll";
import { countRunsByIssue } from "@/lib/run-view-model";
import { orpc } from "@/utils/orpc";

type IssuesBoardProps = {
  organizationId: string;
  repositoryId: string;
  // The repository's "owner/name" label, used to scope this board's org-wide runs
  // to this repository for the per-issue "Runs" count.
  repoFullName: string;
  // The repository's installation settings page on GitHub, used only by the
  // error branch's fix CTA when the installation lacks Issues access. Null when
  // it can't be addressed; the CTA is then omitted.
  installationSettingsUrl?: string | null;
};

// A board issue as the list transport returns it (BoardIssue), narrowed to the
// fields the rows render.
type BoardIssueRow = {
  number: number;
  title: string;
  stage: string;
  claimable: boolean;
  labels: string[];
  commentCount: number;
  updatedAt: string | null;
  linkedPullRequest: { number?: number | null; state: "open" | "closed"; merged: boolean } | null;
};

// Column widths for the board rows, in the runs-table language: a leading stage
// dot, the issue, its labels, the linked PR, its run count, comments, when it
// last moved, and a trailing Kick-off action slot.
const columns: TableColumn<Record<string, unknown>>[] = [
  { key: "stage", header: "", width: pixel(44) },
  { key: "issue", header: "Issue", width: proportional(1) },
  { key: "labels", header: "Labels", width: pixel(200) },
  { key: "pr", header: "Pull request", width: pixel(140) },
  { key: "runs", header: "Runs", width: pixel(80) },
  { key: "comments", header: "Comments", width: pixel(96) },
  { key: "updated", header: "Updated", width: pixel(96) },
  { key: "action", header: "", width: pixel(120) },
];

const groupHeaderCell: CSSProperties = {
  cursor: "pointer",
  backgroundColor: "var(--color-background-muted)",
  padding: "var(--spacing-3) var(--spacing-4)",
};

const interactiveRowStyle: CSSProperties = {
  cursor: "pointer",
};

// The linked PR, in the board's plain-text column: "PR #57 · open" (or merged /
// closed). No colored dot — the one status dot per row is the leading stage dot.
function formatLinkedPullRequest(
  pr: BoardIssueRow["linkedPullRequest"],
): string {
  if (!pr) {
    return "—";
  }
  const state = pr.merged ? "merged" : pr.state;
  return pr.number ? `PR #${pr.number} · ${state}` : `PR · ${state}`;
}

function formatRunCount(count: number): string {
  if (count === 0) {
    return "—";
  }
  return `${count} ${count === 1 ? "run" : "runs"}`;
}

// The board is a grouped table that reads like a kanban — one lane per pipeline
// stage. Stage is derived server-side (see the issues service), so there is no
// drag-to-move.
function stageDotVariant(stage: string): "neutral" | "accent" | "warning" | "success" {
  switch (stage) {
    case "ready_for_agent":
    case "in_pr":
      return "accent";
    case "executing":
    case "failed_blocked":
      return "warning";
    case "merged":
      return "success";
    default:
      return "neutral";
  }
}

function formatUpdated(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function IssuesBoard({
  organizationId,
  repositoryId,
  repoFullName,
  installationSettingsUrl = null,
}: IssuesBoardProps): ReactElement {
  const router = useRouter();
  const showToast = useToast();
  const input = { organizationId, repositoryId };

  // The org's runs, narrowed client-side to this repo and counted per issue for
  // the "Runs" column — the same scoping the issue detail's Runs block uses. No
  // extra API surface; polled on the board's cadence so a new run shows up.
  const runsQuery = useQuery(
    orpc.agentRuns.queryOptions({
      input: { organizationId },
      refetchInterval: issuesRevisionPollInterval,
    }),
  );
  const runCounts = countRunsByIssue(runsQuery.data ?? [], repoFullName);

  // Which stage lanes the user has collapsed. Empty means every lane is expanded
  // (the default), matching the Runs table's collapsible groups (runs-table.tsx).
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set());

  function toggleLane(stage: string): void {
    setCollapsedLanes((current) => toggleLaneCollapsed(current, stage));
  }

  // Poll our own store's change-watermark (never GitHub). The board's live GitHub
  // read is keyed on this watermark, so when a webhook syncs an issue/comment
  // change the key flips and the board refetches on its own — no manual reload
  // (issue #26; issue #19 story 21).
  const revision = useQuery(
    orpc.repositoryIssuesRevision.queryOptions({
      input,
      refetchInterval: issuesRevisionPollInterval,
    }),
  );

  const board = useQuery(
    orpc.listRepositoryIssues.queryOptions({
      input,
      queryKey: [
        ...orpc.listRepositoryIssues.queryKey({ input }),
        { revision: revision.data?.revision ?? null },
      ],
      // Keep the current lanes on screen while a watermark-triggered refetch runs,
      // so a background refresh never flashes the loading state.
      placeholderData: keepPreviousData,
    }),
  );

  const kickOff = useMutation(
    orpc.kickOffIssue.mutationOptions(
      createKickOffHandlers({
        // Re-read the board so the kicked-off row moves to Executing on click
        // (spec #21 stories 1–2), without a manual refresh.
        refetch: () => board.refetch(),
        showToast,
      }),
    ),
  );

  // Kick off from a claimable row without also navigating into the issue: the row
  // is clickable, so stop the click from bubbling to the row's router.push. The
  // Button's own clickAction owns the pending spinner, scoped to that row.
  async function startKickOff(event: { stopPropagation?: () => void }, issueNumber: number) {
    event?.stopPropagation?.();
    try {
      await kickOff.mutateAsync({ organizationId, repositoryId, issueNumber });
    } catch {
      // handled in createKickOffHandlers onError
    }
  }

  if (board.isLoading) {
    return (
      <LayoutContent role="main" padding={4}>
        <Center height="fill" minHeight={240}>
          <Text type="supporting" color="secondary">
            Loading issues…
          </Text>
        </Center>
      </LayoutContent>
    );
  }

  if (board.error && board.data === undefined) {
    // Name the cause. A 403 "Resource not accessible by integration" means this
    // installation can't read Issues — a fixable failure with its own copy and a
    // link to the installation's settings. Other failures keep generic copy.
    // Guarded on `data === undefined` so a transient failure of a background
    // watermark refetch keeps the last good board (the query cache's onError
    // already toasts it) instead of blanking populated lanes.
    const errorContent = mapBoardLoadError(board.error, { installationSettingsUrl });
    return (
      <LayoutContent role="main" padding={4}>
        <EmptyState
          title={errorContent.title}
          description={errorContent.description}
          headingLevel={2}
          actions={
            errorContent.cta ? (
              <Button
                label={errorContent.cta.label}
                variant="secondary"
                size="sm"
                icon={<Icon icon={ArrowTopRightOnSquareIcon} />}
                onClick={() => window.open(errorContent.cta?.href, "_blank", "noopener,noreferrer")}
              />
            ) : undefined
          }
        />
      </LayoutContent>
    );
  }

  const board_ = board.data ?? [];
  const total = board_.reduce((sum, column) => sum + column.issues.length, 0);

  if (total === 0) {
    return (
      <LayoutContent role="main" padding={4}>
        <EmptyState
          title="No issues yet"
          description="Open an issue on this repository — or label one “ready for agent” — and it will appear on the board, grouped by stage."
          headingLevel={2}
        />
      </LayoutContent>
    );
  }

  const resolvedWidths = resolveColumnWidths(columns);
  const colCount = columns.length;

  return (
    <LayoutContent role="main" padding={0}>
      <Table columns={columns} density="balanced" dividers="rows" textOverflow="truncate" hasHover>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={resolvedWidths.columns.get(column.key)?.style} />
          ))}
        </colgroup>
        {/* Rows live in a <tbody> so <tr> is never a direct child of <table>: the
            browser auto-inserts one during parse, which otherwise trips React's
            DOM-nesting validation (a dev-only console error) — mirroring the Runs
            table. */}
        <tbody>
          {board_.map((column) => {
            const expanded = isLaneExpanded(collapsedLanes, column.stage);

            return (
              <Fragment key={column.stage}>
                <TableRow
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleLane(column.stage)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleLane(column.stage);
                    }
                  }}
                >
                  <TableCell colSpan={colCount} style={groupHeaderCell}>
                    <HStack gap={2} vAlign="center">
                      <Icon
                        icon={expanded ? ChevronDownIcon : ChevronRightIcon}
                        size="sm"
                        color="secondary"
                      />
                      <StatusDot variant={stageDotVariant(column.stage)} label={column.label} />
                      <Text type="body" weight="bold">
                        {column.label}
                      </Text>
                      <Badge variant="neutral" label={String(column.issues.length)} />
                    </HStack>
                  </TableCell>
                </TableRow>
                {expanded
                  ? column.issues.map((issue) => {
                      const openIssue = () =>
                        router.push(`/app/projects/${repositoryId}/issues/${issue.number}`);

                      return (
                        <TableRow
                          key={issue.number}
                          role="link"
                          tabIndex={0}
                          style={interactiveRowStyle}
                          onClick={openIssue}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openIssue();
                            }
                          }}
                        >
                          <TableCell>
                            <Center axis="horizontal">
                              <StatusDot
                                variant={stageDotVariant(issue.stage)}
                                label={column.label}
                              />
                            </Center>
                          </TableCell>
                          <TableCell>
                            <HStack gap={2} vAlign="center">
                              <Text type="supporting" color="secondary">
                                #{issue.number}
                              </Text>
                              <Text type="body" maxLines={1}>
                                {issue.title}
                              </Text>
                            </HStack>
                          </TableCell>
                          <TableCell>
                            <HStack gap={1} wrap="wrap">
                              {issue.labels.length === 0 ? (
                                <Text type="supporting" color="secondary">
                                  —
                                </Text>
                              ) : (
                                issue.labels
                                  .slice(0, 3)
                                  .map((label) => <Token key={label} label={label} size="sm" />)
                              )}
                            </HStack>
                          </TableCell>
                          <TableCell>
                            <Text type="supporting" color="secondary" maxLines={1}>
                              {formatLinkedPullRequest(issue.linkedPullRequest)}
                            </Text>
                          </TableCell>
                          <TableCell>
                            <Text type="supporting" color="secondary">
                              {formatRunCount(runCounts.get(issue.number) ?? 0)}
                            </Text>
                          </TableCell>
                          <TableCell>
                            <Text type="supporting" color="secondary">
                              {issue.commentCount > 0 ? String(issue.commentCount) : "—"}
                            </Text>
                          </TableCell>
                          <TableCell>
                            <Text type="supporting" color="secondary">
                              {formatUpdated(issue.updatedAt)}
                            </Text>
                          </TableCell>
                          <TableCell>
                            {issue.claimable ? (
                              <Button
                                label="Kick off"
                                variant="secondary"
                                size="sm"
                                icon={<Icon icon={PlayCircleIcon} size="sm" />}
                                clickAction={(event) => startKickOff(event, issue.number)}
                              />
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </LayoutContent>
  );
}
