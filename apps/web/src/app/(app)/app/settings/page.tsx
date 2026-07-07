import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { client } from "@/utils/orpc";

import SettingsConfigurationClient from "./settings-configuration.client";

export default async function SettingsPage(): Promise<ReactElement> {
  const activeOrganization = await client.activeOrganization();
  const [githubInstallations, providerCredentials] = activeOrganization
    ? await Promise.all([
        client.githubInstallations({ organizationId: activeOrganization.id }),
        client.providerCredentials({ organizationId: activeOrganization.id }),
      ])
    : [[], []];

  return (
    <CoworkerPage
      title="Settings"
      description="Configure the organization pieces that power reviewer runs."
      width="wide"
    >
      <SettingsConfigurationClient
        activeOrganization={activeOrganization}
        githubInstallations={githubInstallations}
        providerCredentials={providerCredentials}
      />
    </CoworkerPage>
  );
}
