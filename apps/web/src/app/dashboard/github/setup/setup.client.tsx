"use client";

import { Button } from "@hosted-agents/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hosted-agents/ui/components/card";
import { Label } from "@hosted-agents/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, GitPullRequest, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

type GitHubSetupClientProps = {
  installationId?: string;
  setupAction?: string;
  state?: string;
};

export default function GitHubSetupClient({
  installationId,
  setupAction,
  state,
}: GitHubSetupClientProps) {
  const organizations = authClient.useListOrganizations();
  const organizationList = useMemo(() => organizations.data ?? [], [organizations.data]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(state ?? "");
  const attemptedClaim = useRef(false);
  const claimGitHubInstallation = useMutation(
    orpc.claimGitHubInstallation.mutationOptions({
      onSuccess: (result) => {
        toast.success(`GitHub installation linked with ${result.repositoryCount} repos`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  useEffect(() => {
    if (!selectedOrganizationId && organizationList[0]) {
      setSelectedOrganizationId(organizationList[0].id);
    }
  }, [organizationList, selectedOrganizationId]);

  useEffect(() => {
    if (
      attemptedClaim.current ||
      !installationId ||
      !selectedOrganizationId ||
      organizations.isPending
    ) {
      return;
    }

    attemptedClaim.current = true;
    claimGitHubInstallation.mutate({
      installationId,
      organizationId: selectedOrganizationId,
      setupAction,
      state,
    });
  }, [
    claimGitHubInstallation,
    installationId,
    organizations.isPending,
    selectedOrganizationId,
    setupAction,
    state,
  ]);

  const canRetry = Boolean(installationId && selectedOrganizationId);

  return (
    <div className="mx-auto grid w-full max-w-xl gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>GitHub Setup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <GitPullRequest className="size-4" />
              <span>
                {installationId
                  ? `Installation ${installationId}`
                  : "No installation id was returned"}
              </span>
            </div>
            {setupAction ? <p className="text-muted-foreground">Action: {setupAction}</p> : null}
          </div>

          {organizationList.length > 0 ? (
            <div className="grid gap-2">
              <Label htmlFor="github-setup-organization">Organization</Label>
              <select
                id="github-setup-organization"
                className="h-8 w-full border border-input bg-background px-2 text-xs"
                value={selectedOrganizationId}
                onChange={(event) => {
                  attemptedClaim.current = false;
                  setSelectedOrganizationId(event.target.value);
                }}
              >
                {organizationList.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {claimGitHubInstallation.isPending ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Linking GitHub installation
            </div>
          ) : null}

          {claimGitHubInstallation.isSuccess ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="size-4" />
              Linked {claimGitHubInstallation.data.repositoryCount} repositories
            </div>
          ) : null}

          {claimGitHubInstallation.isError ? (
            <div className="grid gap-2">
              <p className="text-destructive">{claimGitHubInstallation.error.message}</p>
              <Button
                type="button"
                variant="outline"
                disabled={!canRetry}
                onClick={() => {
                  attemptedClaim.current = false;
                  claimGitHubInstallation.reset();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}

          <Button render={<Link href="/dashboard" />}>Back to Dashboard</Button>
        </CardContent>
      </Card>
    </div>
  );
}
