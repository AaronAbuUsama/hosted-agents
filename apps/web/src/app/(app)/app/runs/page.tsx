import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import CoworkerPage from "@/components/coworker/coworker-page";
import { getMissingSetupPath } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

import RunsTableClient from "@/components/coworker/runs-table-client";

export default async function RunsPage(): Promise<ReactElement> {
  const activeOrganization = await client.activeOrganization();

  if (activeOrganization) {
    const [githubInstallations, providerCredentials] = await Promise.all([
      client.githubInstallations({ organizationId: activeOrganization.id }),
      client.providerCredentials({ organizationId: activeOrganization.id }),
    ]);
    const missingSetupPath = getMissingSetupPath({
      hasGitHubInstallation: githubInstallations.some(
        (installation) => installation.status === "connected" && installation.repositoryCount > 0,
      ),
      hasProviderCredential: providerCredentials.some(
        (credential) =>
          credential.provider === "openai-codex" && credential.status === "connected",
      ),
    });

    if (missingSetupPath) {
      redirect(missingSetupPath);
    }
  }

  return (
    <CoworkerPage variant="workspace" width="full">
      <RunsTableClient />
    </CoworkerPage>
  );
}
