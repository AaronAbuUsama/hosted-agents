import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Layout";
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
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { AddCoworkerButton } from "@/components/coworker/header-actions";
import { coworkerStatusBadgeVariants, coworkers, runs, type Coworker } from "@/lib/coworker-data";

const columns: TableColumn<Coworker>[] = [
  { key: "coworker", header: "Coworker", width: proportional(1) },
  { key: "github", header: "GitHub App", width: pixel(240) },
  { key: "repos", header: "Repos", width: pixel(92) },
  { key: "runs", header: "Runs", width: pixel(116) },
  { key: "status", header: "Status", width: pixel(132) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);

export default function CoworkersPage(): ReactElement {
  return (
    <CoworkerPage
      title="Coworkers"
      description="Named engineering coworkers with distinct GitHub Apps, rules, provider access, and run history."
      actions={<AddCoworkerButton />}
    >
      <Table columns={columns} density="balanced" dividers="rows" textOverflow="truncate" hasHover>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={resolvedColumnWidths.columns.get(column.key)?.style} />
          ))}
        </colgroup>
        <tbody>
          {coworkers.map((coworker) => {
            const coworkerRuns = runs.filter((run) => run.coworkerId === coworker.id);

            return (
              <TableRow key={coworker.id}>
                <TableCell>
                  <HStack gap={3} vAlign="center">
                    <Avatar name={coworker.name} size="small" />
                    <VStack gap={1}>
                      <Link href={`/app/coworkers/${coworker.id}`} isStandalone>
                        {coworker.name}
                      </Link>
                      <Text type="supporting" color="secondary" maxLines={1}>
                        {coworker.role} / {coworker.purpose}
                      </Text>
                    </VStack>
                  </HStack>
                </TableCell>
                <TableCell>
                  <Text type="body" maxLines={1}>
                    {coworker.githubAppName}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" hasTabularNumbers>
                    {coworker.repos}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text type="supporting" hasTabularNumbers>
                    {coworkerRuns.length} recent / {coworker.runsThisWeek} weekly
                  </Text>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={coworkerStatusBadgeVariants[coworker.status]}
                    label={coworker.status}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </tbody>
      </Table>
    </CoworkerPage>
  );
}
