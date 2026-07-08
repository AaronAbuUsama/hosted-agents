import type { ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";

import CoworkerPage from "@/components/coworker/coworker-page";
import GitHubRepositoriesClient from "@/components/coworker/github-repositories.client";
import { SettingsRow, SettingsRows } from "@/components/coworker/settings-rows";
import { client } from "@/utils/orpc";

export default async function GitHubSettingsPage(): Promise<ReactElement> {
  const activeOrganization = await client.activeOrganization();
  const installations = activeOrganization
    ? await client.githubInstallations({ organizationId: activeOrganization.id })
    : [];
  const connected = installations.filter((installation) => installation.status === "connected");
  const repositoryCount = connected.reduce(
    (count, installation) => count + installation.repositoryCount,
    0,
  );

  return (
    <CoworkerPage
      variant="document"
      width="default"
      eyebrow="Settings"
      title="GitHub & repositories"
      description="Reviewer runs start from the GitHub installations linked to this organization. Toggle which repositories the reviewer watches."
      actions={
        <Button
          label="Manage GitHub setup"
          variant="secondary"
          size="sm"
          href="/dashboard/github/setup"
        />
      }
    >
      <SettingsRows>
        <SettingsRow
          label="Linked installations"
          value={connected.length > 0 ? String(connected.length) : "None"}
        />
        <SettingsRow
          label="Linked repositories"
          value={repositoryCount > 0 ? String(repositoryCount) : "None"}
          isLast
        />
      </SettingsRows>
      {installations.length > 0 ? (
        <GitHubRepositoriesClient installations={installations} />
      ) : (
        <EmptyState
          title="No GitHub installation linked"
          description="Install or link the Reviewer GitHub App to start reviewing pull requests."
          headingLevel={2}
        />
      )}
    </CoworkerPage>
  );
}
