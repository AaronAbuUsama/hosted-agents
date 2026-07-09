import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import CoworkerPage from "@/components/coworker/coworker-page";
import FeatureNotEnabled from "@/components/coworker/feature-not-enabled";
import RepositoryWorkspaceClient from "@/components/coworker/repository-workspace-client";
import { APP_LANDING_PATH } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

// A project is a linked GitHub repository. The route param is the repository id
// (github_repository.id); resolve it against the org's installations so the
// workspace only opens for repositories this organization actually owns.
export default async function ProjectPage({ params }: ProjectPageProps): Promise<ReactElement> {
  const { projectId } = await params;

  const activeOrganization = await client.activeOrganization();
  if (!activeOrganization) {
    redirect(APP_LANDING_PATH);
  }

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

  return (
    <CoworkerPage variant="workspace" width="full">
      <RepositoryWorkspaceClient
        fullName={repository.fullName}
        repositoryId={repository.id}
        organizationId={activeOrganization.id}
      />
    </CoworkerPage>
  );
}
