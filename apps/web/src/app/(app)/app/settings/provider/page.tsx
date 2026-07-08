import type { ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Token } from "@astryxdesign/core/Token";

import CoworkerPage from "@/components/coworker/coworker-page";
import { SettingsRow, SettingsRows } from "@/components/coworker/settings-rows";
import { client } from "@/utils/orpc";

function formatProviderName(provider: string): string {
  return provider === "openai-codex" ? "OpenAI Codex" : provider;
}

function formatExpiry(expiresAt: string | Date | null | undefined): string {
  if (!expiresAt) {
    return "No expiry";
  }
  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? "No expiry" : `Expires ${parsed.toLocaleString()}`;
}

export default async function ProviderSettingsPage(): Promise<ReactElement> {
  const activeOrganization = await client.activeOrganization();
  const credentials = activeOrganization
    ? await client.providerCredentials({ organizationId: activeOrganization.id })
    : [];
  const connected = credentials.filter(
    (credential) => credential.provider === "openai-codex" && credential.status === "connected",
  );

  return (
    <CoworkerPage
      variant="document"
      width="default"
      eyebrow="Settings"
      title="Provider"
      description="The model-provider credential reviewer runs use for code review work."
      actions={
        <Button label="Manage provider" variant="secondary" size="sm" href="/onboarding/provider" />
      }
    >
      {connected.length > 0 ? (
        <SettingsRows>
          {connected.map((credential, index) => (
            <SettingsRow
              key={credential.id}
              label={formatProviderName(credential.provider)}
              value={`${credential.credentialType} · ${formatExpiry(credential.expiresAt)}`}
              endContent={<Token label="Connected" color="green" size="sm" />}
              isLast={index === connected.length - 1}
            />
          ))}
        </SettingsRows>
      ) : (
        <EmptyState
          title="No provider credential connected"
          description="Connect OpenAI Codex before reviewer runs can execute."
          headingLevel={2}
        />
      )}
    </CoworkerPage>
  );
}
