import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { SettingsRow, SettingsRows } from "@/components/coworker/settings-rows";
import { client } from "@/utils/orpc";

export default async function OrganizationSettingsPage(): Promise<ReactElement> {
  const activeOrganization = await client.activeOrganization();

  return (
    <CoworkerPage
      variant="document"
      width="default"
      eyebrow="Settings"
      title="Organization"
      description="The Coworker organization that owns runs, GitHub installations, provider credentials, and future rules."
    >
      <SettingsRows>
        <SettingsRow label="Name" value={activeOrganization?.name ?? "No active organization"} />
        <SettingsRow label="Slug" value={activeOrganization?.slug ?? "Not set"} />
        <SettingsRow label="Your role" value={activeOrganization?.role ?? "None"} isLast />
      </SettingsRows>
    </CoworkerPage>
  );
}
