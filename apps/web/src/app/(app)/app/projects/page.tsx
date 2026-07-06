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
import { Heading, Text } from "@astryxdesign/core/Text";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { LinkRepositoryButton, SyncGitHubButton } from "@/components/coworker/header-actions";
import {
  projectLabelSetupBadgeVariants,
  projects,
  projectStatusBadgeVariants,
  type Project,
} from "@/lib/coworker-data";

const columns: TableColumn<Project>[] = [
  { key: "project", header: "Repository", width: proportional(1) },
  { key: "mode", header: "Coworkers", width: pixel(240) },
  { key: "health", header: "Health", width: pixel(180) },
  { key: "activity", header: "Activity", width: pixel(180) },
  { key: "sync", header: "Last sync", width: pixel(132) },
];

const resolvedColumnWidths = resolveColumnWidths(columns);

export default function ProjectsPage(): ReactElement {
  const activeProjects = projects.filter((project) => project.status !== "Needs setup").length;
  const projectsNeedingSetup = projects.length - activeProjects;

  return (
    <CoworkerPage
      title="Projects"
      description="Linked GitHub repositories where named coworkers can review pull requests, sync issues, and attach runs."
      actions={
        <HStack gap={2} wrap="wrap">
          <SyncGitHubButton />
          <LinkRepositoryButton variant="primary" />
        </HStack>
      }
    >
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Badge variant="blue" label={`All ${projects.length}`} />
        <Badge variant="neutral" label={`Active ${activeProjects}`} />
        <Badge variant="neutral" label={`Needs setup ${projectsNeedingSetup}`} />
      </HStack>

      <VStack gap={3}>
        <Heading level={2}>Repositories</Heading>
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
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <VStack gap={1}>
                    <Link href={`/app/projects/${project.id}`} isStandalone>
                      {project.name}
                    </Link>
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {project.summary}
                    </Text>
                  </VStack>
                </TableCell>
                <TableCell>
                  <HStack gap={1} wrap="wrap">
                    {project.modes.map((mode) => (
                      <Badge key={mode} variant="neutral" label={mode} />
                    ))}
                  </HStack>
                </TableCell>
                <TableCell>
                  <VStack gap={1}>
                    <HStack>
                      <Badge
                        variant={projectStatusBadgeVariants[project.status]}
                        label={project.status}
                      />
                    </HStack>
                    <HStack>
                      <Badge
                        variant={projectLabelSetupBadgeVariants[project.labelSetup]}
                        label={project.labelSetup}
                      />
                    </HStack>
                  </VStack>
                </TableCell>
                <TableCell>
                  <HStack gap={3} vAlign="center">
                    <Text type="supporting" hasTabularNumbers>
                      {project.openPullRequests} PRs
                    </Text>
                    <Text type="supporting" hasTabularNumbers>
                      {project.syncedIssues || "-"} issues
                    </Text>
                  </HStack>
                </TableCell>
                <TableCell>
                  <Text type="supporting">{project.lastSync}</Text>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </VStack>
    </CoworkerPage>
  );
}
