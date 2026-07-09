import type { ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { Token } from "@astryxdesign/core/Token";

import CoworkerPage from "@/components/coworker/coworker-page";
import { TRIGGER_EVENTS } from "@/components/coworker/reviewer-triggers";
import { SettingsRow, SettingsRows } from "@/components/coworker/settings-rows";
import { client } from "@/utils/orpc";

export default async function ReviewerSettingsPage(): Promise<ReactElement> {
  const activeOrganization = await client.activeOrganization();
  const installations = activeOrganization
    ? await client.githubInstallations({ organizationId: activeOrganization.id })
    : [];
  const hasGitHubInstallation = installations.some(
    (installation) => installation.status === "connected",
  );

  return (
    <CoworkerPage
      variant="document"
      width="default"
      eyebrow="Settings"
      title="Reviewer"
      description="How the reviewer runs. Its prompt, model, and skills live on the Reviewer page and apply to every new run."
      actions={
        <Button label="Configure reviewer" variant="secondary" size="sm" href="/app/reviewer" />
      }
    >
      <SettingsRows>
        <SettingsRow label="Prompt and skills" value="Managed on the Reviewer page" />
        <SettingsRow
          label="Triggers"
          value="Pull request events that queue a review"
          endContent={
            <HStack gap={1} wrap="wrap" hAlign="end">
              {TRIGGER_EVENTS.map((trigger) => (
                <Token key={trigger} label={trigger} size="sm" />
              ))}
            </HStack>
          }
        />
        <SettingsRow label="Default run type" value="GitHub pull request review" />
        <SettingsRow
          label="Repository scope"
          value={
            hasGitHubInstallation
              ? "Enabled repositories from linked GitHub installations"
              : "Not configured — link a GitHub installation first"
          }
        />
        <SettingsRow
          label="Artifact retention"
          value="Durable run events and GitHub output"
          isLast
        />
      </SettingsRows>
    </CoworkerPage>
  );
}
