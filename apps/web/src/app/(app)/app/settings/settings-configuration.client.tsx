"use client";

import { Button } from "@hosted-agents/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hosted-agents/ui/components/card";
import { CheckCircle2, ExternalLink, GitPullRequest, KeyRound, Settings2 } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { client } from "@/utils/orpc";

type ActiveOrganization = Awaited<ReturnType<typeof client.activeOrganization>>;
type GitHubInstallation = Awaited<ReturnType<typeof client.githubInstallations>>[number];
type ProviderCredential = Awaited<ReturnType<typeof client.providerCredentials>>[number];

type SettingsConfigurationClientProps = {
  activeOrganization: ActiveOrganization;
  githubInstallations: GitHubInstallation[];
  providerCredentials: ProviderCredential[];
};

export default function SettingsConfigurationClient({
  activeOrganization,
  githubInstallations,
  providerCredentials,
}: SettingsConfigurationClientProps): ReactElement {
  const linkedReviewerInstallations = githubInstallations.filter(
    (installation) => installation.status === "connected",
  );
  const connectedProviderCredentials = providerCredentials.filter(
    (credential) => credential.provider === "openai-codex" && credential.status === "connected",
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <SettingsRow label="Name" value={activeOrganization?.name ?? "No active organization"} />
          <SettingsRow label="Role" value={activeOrganization?.role ?? "none"} />
          <SettingsRow label="Slug" value={activeOrganization?.slug ?? "none"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest className="size-4" />
            Reviewer GitHub App
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {linkedReviewerInstallations.length > 0 ? (
            <div className="grid gap-2">
              {linkedReviewerInstallations.map((installation) => (
                <div
                  key={installation.id}
                  className="grid gap-1 rounded-md border border-border bg-background p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    <span className="font-medium">
                      {installation.accountLogin ?? "GitHub installation"}
                    </span>
                    <span className="text-muted-foreground">{installation.status}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {installation.repositoryCount} repositories linked
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Reviewer GitHub App installation is linked to this organization.
            </p>
          )}
          <Button nativeButton={false} variant="outline" render={<Link href="/dashboard/github/setup" />}>
            <ExternalLink className="size-4" />
            Manage GitHub setup
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            OpenAI Codex Provider
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {connectedProviderCredentials.length > 0 ? (
            <div className="grid gap-2">
              {connectedProviderCredentials.map((credential) => (
                <div
                  key={credential.id}
                  className="grid gap-1 rounded-md border border-border bg-background p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    <span className="font-medium">{credential.provider}</span>
                    <span className="text-muted-foreground">{credential.status}</span>
                  </div>
                  <p className="text-muted-foreground">
                    Type: {credential.credentialType}
                    {credential.expiresAt
                      ? ` · Expires: ${new Date(credential.expiresAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No OpenAI Codex provider credential is connected to this organization.
            </p>
          )}
          <Button nativeButton={false} variant="outline" render={<Link href="/onboarding/provider" />}>
            <ExternalLink className="size-4" />
            Manage provider credential
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
