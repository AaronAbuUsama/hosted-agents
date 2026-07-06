import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Layout";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { ConfigureButton, KickOffRunButton } from "@/components/coworker/header-actions";
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

export default async function ProjectPage({ params }: ProjectPageProps): Promise<ReactElement> {
  const { projectId } = await params;
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const reviewer = coworkers.find((coworker) => coworker.id === project.reviewerCoworkerId);
  const implementer = coworkers.find((coworker) => coworker.id === project.implementerCoworkerId);
  const projectRuns = runs.filter((run) => run.repo === project.repo);
  const reviews = pullRequestReviews.filter((review) => review.projectId === project.id);
  const issues = projectIssues.filter((issue) => issue.projectId === project.id);
  const hasIssueSync = project.modes.includes("Issue board") && implementer !== undefined;

  return (
    <CoworkerPage
      variant="workspace"
      width="full"
      eyebrow={project.repo}
      title={project.name}
      description={[
        reviewer ? `${reviewer.name} reviews pull requests` : "No reviewer installed",
        implementer
          ? `${implementer.name} can implement assigned issues`
          : "Issue implementation not enabled",
        project.branches.join(", "),
      ].join(" / ")}
      actions={
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Badge variant={projectStatusBadgeVariants[project.status]} label={project.status} />
          <Badge
            variant={projectLabelSetupBadgeVariants[project.labelSetup]}
            label={`Labels: ${project.labelSetup}`}
          />
          <KickOffRunButton />
          <ConfigureButton />
        </HStack>
      }
    >
      <ProjectWorkspace
        project={project}
        issues={issues}
        reviews={reviews}
        runs={projectRuns}
        hasIssueSync={hasIssueSync}
      />
    </CoworkerPage>
  );
}
