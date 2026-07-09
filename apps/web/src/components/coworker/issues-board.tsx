"use client";

import { Fragment, type CSSProperties, type ReactElement } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
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
import { Token } from "@astryxdesign/core/Token";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { orpc } from "@/utils/orpc";

type IssuesBoardProps = {
  organizationId: string;
  repositoryId: string;
};

// Column widths for the board rows; a leading stage dot, the issue, its labels,
// a comment count, and when it last moved.
const columns: TableColumn<Record<string, unknown>>[] = [
  { key: "stage", header: "", width: pixel(44) },
  { key: "issue", header: "Issue", width: proportional(1) },
  { key: "labels", header: "Labels", width: pixel(240) },
  { key: "comments", header: "Comments", width: pixel(96) },
  { key: "updated", header: "Updated", width: pixel(96) },
];

const groupHeaderCell: CSSProperties = {
  backgroundColor: "var(--color-background-muted)",
  padding: "var(--spacing-3) var(--spacing-4)",
};

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
}: IssuesBoardProps): ReactElement {
  const router = useRouter();
  const board = useQuery(
    orpc.listRepositoryIssues.queryOptions({
      input: { organizationId, repositoryId },
    }),
  );

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

  if (board.error) {
    return (
      <LayoutContent role="main" padding={4}>
        <EmptyState
          title="Couldn't load issues"
          description={
            board.error instanceof Error
              ? board.error.message
              : "GitHub did not return this repository's issues. Check the installation and try again."
          }
          headingLevel={2}
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
        {board_.map((column) => (
          <Fragment key={column.stage}>
            <TableRow>
              <TableCell colSpan={colCount} style={groupHeaderCell}>
                <HStack gap={2} vAlign="center">
                  <StatusDot variant={stageDotVariant(column.stage)} label={column.label} />
                  <Text type="body" weight="bold">
                    {column.label}
                  </Text>
                  <Badge variant="neutral" label={String(column.issues.length)} />
                </HStack>
              </TableCell>
            </TableRow>
            {column.issues.map((issue) => (
              <TableRow
                key={issue.number}
                onClick={() =>
                  router.push(`/app/projects/${repositoryId}/issues/${issue.number}`)
                }
              >
                <TableCell>
                  <Center axis="horizontal">
                    <StatusDot variant={stageDotVariant(issue.stage)} label={column.label} />
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
                    {issue.claimable ? (
                      <Token label="agent-ready" size="sm" />
                    ) : null}
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
                  <Text type="supporting" color="secondary">
                    {issue.commentCount > 0 ? String(issue.commentCount) : "—"}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" color="secondary">
                    {formatUpdated(issue.updatedAt)}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </Table>
    </LayoutContent>
  );
}
