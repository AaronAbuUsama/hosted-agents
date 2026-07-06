import { Badge } from "@astryxdesign/core/Badge";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import ProjectWorkspace from "@/components/coworker/project-workspace";
import {
  coworkers,
  projectIssues,
  projectLabelSetupBadgeVariants,
  projects,
  projectStatusBadgeVariants,
  pullRequestReviews,
  runs,
} from "@/lib/coworker-data";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

type SetupRowProps = {
  label: string;
  value: string;
};

type SummaryMetric = {
  label: string;
  value: string | number;
  hasTabularNumbers?: boolean;
};

const projectTabs = ["Overview", "Activity", "Issues", "Settings"] as const;

export default async function ProjectPage({ params }: ProjectPageProps): Promise<ReactElement> {
  const { projectId } = await params;
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const reviewer = coworkers.find((coworker) => coworker.id === project.reviewerCoworkerId);
  const implementer = coworkers.find((coworker) => coworker.id === project.implementerCoworkerId);
  const branchList = project.branches.join(", ");
  const projectRuns = runs.filter((run) => run.repo === project.repo);
  const reviews = pullRequestReviews.filter((review) => review.projectId === project.id);
  const issues = projectIssues.filter((issue) => issue.projectId === project.id);
  const hasIssueSync = project.modes.includes("Issue board") && implementer !== undefined;
  const summaryMetrics: SummaryMetric[] = [
    { label: "Open PRs", value: project.openPullRequests, hasTabularNumbers: true },
    { label: "Synced issues", value: hasIssueSync ? project.syncedIssues : "Not enabled", hasTabularNumbers: true },
    { label: "Active runs", value: project.activeRuns, hasTabularNumbers: true },
    { label: "Last sync", value: project.lastSync },
  ];

  return (
    <CoworkerPage>
        <section className="border-b border-border pb-3">
          <VStack gap={3}>
            <HStack hAlign="between" vAlign="start">
              <VStack gap={1}>
                <HStack gap={2} vAlign="center">
                  <Link href="/app/projects" isStandalone>
                    Projects
                  </Link>
                  <Text type="supporting" color="secondary">
                    /
                  </Text>
                  <Text weight="semibold">{project.name}</Text>
                </HStack>
                <Text type="supporting" as="p">
                  {project.summary}
                </Text>
              </VStack>
              <HStack gap={2} wrap="wrap">
                {project.modes.map((mode) => (
                  <Badge key={mode} variant="neutral" label={mode} />
                ))}
                <Badge variant={projectStatusBadgeVariants[project.status]} label={project.status} />
              </HStack>
            </HStack>

            <nav className="flex items-center gap-4" aria-label="Project sections">
              {projectTabs.map((tab) => {
                const isActive = tab === "Issues";

                return (
                  <a
                    key={tab}
                    href={`#${tab.toLowerCase()}`}
                    className={
                      isActive
                        ? "border-b border-primary pb-2 text-sm font-medium text-primary"
                        : "border-b border-transparent pb-2 text-sm text-muted-foreground hover:text-primary"
                    }
                  >
                    {tab}
                  </a>
                );
              })}
            </nav>
          </VStack>
        </section>

        <section className="grid gap-3 lg:grid-cols-4" aria-label="Project summary">
          {summaryMetrics.map(({ label, value, hasTabularNumbers }) => (
            <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
              <VStack gap={1}>
                <Text type="label" color="secondary">
                  {label}
                </Text>
                {hasTabularNumbers ? (
                  <Text weight="semibold" hasTabularNumbers>
                    {value}
                  </Text>
                ) : (
                  <Text weight="semibold">{value}</Text>
                )}
              </VStack>
            </div>
          ))}
        </section>

        <ProjectWorkspace issues={issues} reviews={reviews} runs={projectRuns} hasIssueSync={hasIssueSync} />

        <section
          id="settings"
          className="overflow-hidden rounded-xl border border-border bg-card"
          aria-labelledby="project-configuration-title"
        >
          <div className="border-b border-border px-5 py-4">
            <HStack hAlign="between" vAlign="start">
              <VStack gap={1}>
                <Heading level={2} id="project-configuration-title">
                  Project configuration
                </Heading>
                <Text type="supporting" as="p">
                  Linked repository, branch scope, coworker access, and issue-board setup.
                </Text>
              </VStack>
              <Link href="/app/settings?section=repositories" isStandalone>
                Configure
              </Link>
            </HStack>
          </div>
          <div className="grid gap-x-10 gap-y-0 p-5 xl:grid-cols-2">
            <VStack gap={3}>
              <SetupRow label="Repository" value={project.repo} />
              <SetupRow label="Branches" value={branchList} />
              <SetupRow label="Status" value={project.status} />
              <SetupRow label="Labels" value={project.labelSetup} />
            </VStack>
            <VStack gap={3}>
              <SetupRow label="Pull request reviewer" value={reviewer?.name ?? "Not installed"} />
              <SetupRow label="Issue implementer" value={implementer?.name ?? "Not installed"} />
              <SetupRow label="Issue sync" value={hasIssueSync ? "Enabled" : "Not enabled"} />
              <HStack>
                <Badge variant={projectLabelSetupBadgeVariants[project.labelSetup]} label={`Label setup: ${project.labelSetup}`} />
              </HStack>
            </VStack>
          </div>
        </section>
    </CoworkerPage>
  );
}

function SetupRow({ label, value }: SetupRowProps): ReactElement {
  return (
    <HStack hAlign="between" vAlign="center">
      <Text type="supporting">{label}</Text>
      <Text weight="semibold">{value}</Text>
    </HStack>
  );
}
