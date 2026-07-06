import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Link } from "@astryxdesign/core/Link";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
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
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { ConfigureButton } from "@/components/coworker/header-actions";
import {
  coworkerStatusBadgeVariants,
  coworkers,
  rules,
  ruleStatusBadgeVariants,
  runs,
  summaryRunStatusBadgeVariants,
  type Rule,
  type Run,
} from "@/lib/coworker-data";

type CoworkerProfilePageProps = {
  params: Promise<{ coworkerId: string }>;
};

const ruleColumns: TableColumn<Rule>[] = [
  { key: "rule", header: "Rule", width: proportional(1) },
  { key: "trigger", header: "Trigger", width: pixel(220) },
  { key: "guardrail", header: "Guardrail", width: pixel(240) },
  { key: "status", header: "Status", width: pixel(120) },
];

const runColumns: TableColumn<Run>[] = [
  { key: "run", header: "Run", width: proportional(1) },
  { key: "repo", header: "Repository", width: pixel(180) },
  { key: "status", header: "Status", width: pixel(132) },
  { key: "duration", header: "Duration", width: pixel(92) },
];

const ruleColumnWidths = resolveColumnWidths(ruleColumns);
const runColumnWidths = resolveColumnWidths(runColumns);

export default async function CoworkerProfilePage({
  params,
}: CoworkerProfilePageProps): Promise<ReactElement> {
  const { coworkerId } = await params;
  const coworker = coworkers.find((item) => item.id === coworkerId);

  if (!coworker) {
    notFound();
  }

  const coworkerRuns = runs.filter((run) => run.coworkerId === coworker.id);
  const coworkerRules = rules.filter((rule) => rule.coworkerId === coworker.id);

  return (
    <CoworkerPage
      title={coworker.name}
      eyebrow={coworker.role}
      description={`${coworker.email} / ${coworker.githubAppName}`}
      actions={
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Badge variant={coworkerStatusBadgeVariants[coworker.status]} label={coworker.status} />
          <ConfigureButton />
        </HStack>
      }
    >
      <HStack gap={6} vAlign="start">
        <VStack gap={4}>
          <HStack gap={3} vAlign="center">
            <Avatar name={coworker.name} size="large" />
            <VStack gap={1}>
              <Heading level={2}>Identity</Heading>
              <Text type="supporting" color="secondary">
                {coworker.purpose}
              </Text>
            </VStack>
          </HStack>
          <MetadataList label={{ position: "start" }}>
            <MetadataListItem label="GitHub App">{coworker.githubAppName}</MetadataListItem>
            <MetadataListItem label="Repositories">{coworker.repos}</MetadataListItem>
            <MetadataListItem label="Runs this week">{coworker.runsThisWeek}</MetadataListItem>
          </MetadataList>
        </VStack>
        <StackItem size="fill">
          <VStack gap={5}>
            <VStack gap={3}>
              <Heading level={2}>Rules</Heading>
              <Table
                columns={ruleColumns}
                density="balanced"
                dividers="rows"
                textOverflow="truncate"
                hasHover
              >
                <colgroup>
                  {ruleColumns.map((column) => (
                    <col key={column.key} style={ruleColumnWidths.columns.get(column.key)?.style} />
                  ))}
                </colgroup>
                <tbody>
                  {coworkerRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <VStack gap={1}>
                          <Text weight="semibold">{rule.name}</Text>
                          <Text type="supporting" color="secondary" maxLines={1}>
                            {rule.action}
                          </Text>
                        </VStack>
                      </TableCell>
                      <TableCell>
                        <Text type="supporting" maxLines={2}>
                          {rule.trigger}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text type="supporting" maxLines={2}>
                          {rule.guardrail}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ruleStatusBadgeVariants[rule.status]} label={rule.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </VStack>

            <VStack gap={3}>
              <Heading level={2}>Recent runs</Heading>
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
                  {coworkerRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <VStack gap={1}>
                          <Link href={`/app/runs/${run.id}`} isStandalone>
                            {run.title}
                          </Link>
                          <Text type="supporting" color="secondary" maxLines={1}>
                            {run.trigger} / {run.result}
                          </Text>
                        </VStack>
                      </TableCell>
                      <TableCell>
                        <Text type="supporting">{run.repo}</Text>
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
          </VStack>
        </StackItem>
      </HStack>
    </CoworkerPage>
  );
}
