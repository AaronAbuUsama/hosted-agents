"use client";

import { Button } from "@hosted-agents/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hosted-agents/ui/components/card";
import { Label } from "@hosted-agents/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

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
  const [isStartingReviewerInstall, setIsStartingReviewerInstall] = useState(false);
  const attemptedClaim = useRef(false);
  const selectedOrganization = organizationList.find(
    (organization) => organization.id === selectedOrganizationId,
  );
  const {
    data: linkedInstallationData,
    error: linkedInstallationsError,
    isError: isLinkedInstallationsError,
    isFetching: isFetchingLinkedInstallations,
    isPending: isPendingLinkedInstallations,
    refetch: refetchLinkedInstallations,
  } = useQuery(
    orpc.githubInstallations.queryOptions({
      input: selectedOrganizationId ? { organizationId: selectedOrganizationId } : undefined,
      enabled: Boolean(selectedOrganizationId),
    }),
  );
  const installations = linkedInstallationData ?? [];
  const linkedRepositoryCount = installations.reduce(
    (count, installation) => count + installation.repositoryCount,
    0,
  );
  const startReviewerInstall = async () => {
    if (!selectedOrganizationId) {
      toast.error("Select an organization before installing the Reviewer GitHub App.");
      return;
    }

    setIsStartingReviewerInstall(true);

    try {
      const result = await client.githubAppInstallUrl({ organizationId: selectedOrganizationId });

      if (!result.configured || !result.installUrl) {
        toast.error("Reviewer GitHub App is not configured for this environment.");
        setIsStartingReviewerInstall(false);
        return;
      }

      window.location.assign(result.installUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start GitHub install.");
      setIsStartingReviewerInstall(false);
    }
  };
  const claimGitHubInstallation = useMutation(
    orpc.claimGitHubInstallation.mutationOptions({
      onSuccess: (result) => {
        toast.success(`GitHub installation linked with ${result.repositoryCount} repos`);
        void refetchLinkedInstallations();
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
  const isLoadingLinkedState =
    isPendingLinkedInstallations || isFetchingLinkedInstallations || organizations.isPending;
  const hasLinkedReviewer = installations.length > 0;
  const canContinueToProvider = hasLinkedReviewer || claimGitHubInstallation.isSuccess;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Reviewer GitHub App setup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <GitPullRequest className="size-4" />
              <span>
                {installationId
                  ? `GitHub returned installation ${installationId}`
                  : "Install or verify the Reviewer GitHub App"}
              </span>
            </div>
            {setupAction ? <p className="text-muted-foreground">Action: {setupAction}</p> : null}
            {selectedOrganization ? (
              <p className="text-muted-foreground">
                Linking into {selectedOrganization.name}. GitHub returns here with an
                installation id; the API then persists the installation and selected repositories.
              </p>
            ) : null}
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
          ) : organizations.isPending ? (
            <LoadingState label="Loading organizations" />
          ) : (
            <div className="grid gap-2">
              <p className="text-muted-foreground">
                Create an organization before installing the Reviewer GitHub App.
              </p>
              <Button nativeButton={false} render={<Link href="/onboarding/organization" />}>
                Create organization
              </Button>
            </div>
          )}

          {installationId ? (
            <ClaimStatus
              canRetry={canRetry}
              errorMessage={
                claimGitHubInstallation.isError ? claimGitHubInstallation.error.message : null
              }
              isPending={claimGitHubInstallation.isPending}
              isSuccess={claimGitHubInstallation.isSuccess}
              repositoryCount={claimGitHubInstallation.data?.repositoryCount ?? 0}
              onRetry={() => {
                attemptedClaim.current = false;
                claimGitHubInstallation.reset();
              }}
            />
          ) : (
            <div className="grid gap-3">
              {hasLinkedReviewer ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                  Reviewer app linked with {linkedRepositoryCount} repositories
                </div>
              ) : isLoadingLinkedState ? (
                <LoadingState label="Checking linked GitHub installations" />
              ) : (
                <p className="text-muted-foreground">
                  No Reviewer GitHub App installation is linked to this organization yet.
                </p>
              )}

              <Button
                type="button"
                disabled={!selectedOrganizationId || isStartingReviewerInstall}
                onClick={() => void startReviewerInstall()}
              >
                {isStartingReviewerInstall ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Opening GitHub
                  </>
                ) : (
                  <>
                    <ExternalLink className="size-4" />
                    {hasLinkedReviewer
                      ? "Manage Reviewer GitHub App"
                      : "Install Reviewer GitHub App"}
                  </>
                )}
              </Button>
            </div>
          )}

          {isLinkedInstallationsError ? (
            <p className="text-destructive">{linkedInstallationsError.message}</p>
          ) : null}

          {hasLinkedReviewer ? <LinkedReviewerState installations={installations} /> : null}

          <div className="flex flex-wrap gap-2">
            {canContinueToProvider ? (
              <Button nativeButton={false} render={<Link href="/onboarding/provider" />}>
                Continue to provider credentials
              </Button>
            ) : (
              <Button type="button" disabled>
                Continue to provider credentials
              </Button>
            )}
            <Button nativeButton={false} variant="outline" render={<Link href="/app/runs" />}>
              Open runs
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type LinkedGitHubInstallation = {
  id: string;
  accountLogin: string | null;
  repositorySelection: string | null;
  status: string;
  repositoryCount: number;
  repositories: {
    id: string;
    fullName: string;
    htmlUrl: string | null;
    defaultBranch: string | null;
    private: boolean;
  }[];
};

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function ClaimStatus({
  canRetry,
  errorMessage,
  isPending,
  isSuccess,
  repositoryCount,
  onRetry,
}: {
  canRetry: boolean;
  errorMessage: string | null;
  isPending: boolean;
  isSuccess: boolean;
  repositoryCount: number;
  onRetry: () => void;
}) {
  if (isPending) {
    return <LoadingState label="Linking GitHub installation" />;
  }

  if (isSuccess) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <CheckCircle2 className="size-4" />
        Linked {repositoryCount} repositories
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="grid gap-2">
        <p className="text-destructive">{errorMessage}</p>
        <Button type="button" variant="outline" disabled={!canRetry} onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return null;
}

function LinkedReviewerState({
  installations,
}: {
  installations: LinkedGitHubInstallation[];
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      {installations.map((installation) => (
        <div className="grid gap-3" key={installation.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <p className="text-sm font-medium">
                {installation.accountLogin ?? "GitHub installation"}
              </p>
              <p className="text-muted-foreground text-xs">
                {installation.status} · {installation.repositorySelection ?? "selected"} repos ·{" "}
                {installation.repositoryCount} persisted
              </p>
            </div>
            <CheckCircle2 className="size-4 text-muted-foreground" />
          </div>

          {installation.repositories.length > 0 ? (
            <ul className="grid gap-2">
              {installation.repositories.map((repository) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs"
                  key={repository.id}
                >
                  <span>{repository.fullName}</span>
                  <span className="text-muted-foreground">
                    {repository.private ? "Private" : "Public"}
                    {repository.defaultBranch ? ` · ${repository.defaultBranch}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              GitHub returned no repositories for this installation.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
