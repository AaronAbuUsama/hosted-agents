import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import ProjectWorkspace from "@/components/coworker/project-workspace";
import { projectIssues, projects, pullRequestReviews, runs } from "@/lib/coworker-data";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: ProjectPageProps): Promise<ReactElement> {
  const { projectId } = await params;
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const projectRuns = runs.filter((run) => run.repo === project.repo);
  const reviews = pullRequestReviews.filter((review) => review.projectId === project.id);
  const issues = projectIssues.filter((issue) => issue.projectId === project.id);
  const hasIssueSync = project.modes.includes("Issue board");

  return (
    <CoworkerPage variant="workspace" width="full">
      <ProjectWorkspace
        issues={issues}
        reviews={reviews}
        runs={projectRuns}
        hasIssueSync={hasIssueSync}
      />
    </CoworkerPage>
  );
}
