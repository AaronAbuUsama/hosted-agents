import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import CoworkerPage from "@/components/coworker/coworker-page";
import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";
import IssueDetailClient from "@/components/coworker/issue-detail-client";
import { APP_LANDING_PATH } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

type ProjectIssuePageProps = {
  // [projectId] is the repository id (github_repository.id); [issueId] is the
  // GitHub issue number the board links to.
  params: Promise<{ projectId: string; issueId: string }>;
};

export default async function ProjectIssuePage({
  params,
}: ProjectIssuePageProps): Promise<ReactElement> {
  const { projectId, issueId } = await params;

  const activeOrganization = await client.activeOrganization();
  if (!activeOrganization) {
    redirect(APP_LANDING_PATH);
  }

  // Resolve the repository against the org's installations so the issue only
  // opens for a repository this organization actually owns (tenant boundary).
  const installations = await client.githubInstallations({
    organizationId: activeOrganization.id,
  });
  const repository = installations
    .flatMap((installation) => installation.repositories)
    .find((repo) => repo.id === projectId);

  if (!repository) {
    return (
      <FeatureNotEnabled
        featureName="This project"
        description="This repository isn't linked to your Coworker organization, or it has been removed. Enable a repository in Settings to open its workspace."
      />
    );
  }

  const issueNumber = Number(issueId);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return (
      <FeatureNotEnabled
        featureName="This issue"
        description="That issue reference isn't valid. Open an issue from the board to view its detail."
      />
    );
  }

  return (
    <CoworkerPage variant="workspace" width="full">
      <IssueDetailClient
        organizationId={activeOrganization.id}
        repositoryId={repository.id}
        fullName={repository.fullName}
        issueNumber={issueNumber}
      />
    </CoworkerPage>
  );
}
