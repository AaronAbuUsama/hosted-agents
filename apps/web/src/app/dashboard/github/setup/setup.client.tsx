"use client";

import { Button } from "@hosted-agents/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hosted-agents/ui/components/card";
import { Label } from "@hosted-agents/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, GitPullRequest, Loader2, RefreshCw } from "lucide-react";
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
  const {
    data: availableInstallationData,
    error: availableInstallationsError,
    isError: isAvailableInstallationsError,
    isFetching: isFetchingAvailableInstallations,
    isPending: isPendingAvailableInstallations,
    refetch: refetchAvailableInstallations,
  } = useQuery(
    orpc.availableGitHubInstallations.queryOptions({
      input: selectedOrganizationId ? { organizationId: selectedOrganizationId } : undefined,
      enabled: Boolean(selectedOrganizationId),
    }),
  );
  const availableInstallations = availableInstallationData?.installations ?? [];
  const isGitHubAppConfigured = availableInstallationData?.configured ?? true;
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
        void refetchAvailableInstallations();
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
  const isLoadingAvailableState =
    isPendingAvailableInstallations || isFetchingAvailableInstallations || organizations.isPending;
  const hasLinkedReviewer = installations.length > 0;
  const canContinueToProvider = hasLinkedReviewer || claimGitHubInstallation.isSuccess;
  const pendingInstallationId = claimGitHubInstallation.variables?.installationId ?? null;
  const refreshGitHubState = () => {
    void refetchLinkedInstallations();
    void refetchAvailableInstallations();
  };

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
                Linking into {selectedOrganization.name}. This Coworker organization can use
                repositories from multiple GitHub App installations.
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
          ) : null}

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
                No Reviewer GitHub App installation is linked to this Coworker organization yet.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
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
                    {hasLinkedReviewer ? "Configure on GitHub" : "Install or configure on GitHub"}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!selectedOrganizationId || isLoadingAvailableState}
                onClick={refreshGitHubState}
              >
                {isLoadingAvailableState ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>

          <AvailableInstallationsState
            configured={isGitHubAppConfigured}
            errorMessage={
              isAvailableInstallationsError ? availableInstallationsError.message : null
            }
            installations={availableInstallations}
            isClaiming={claimGitHubInstallation.isPending}
            isLoading={isLoadingAvailableState}
            pendingInstallationId={pendingInstallationId}
            onLink={(availableInstallation, setupMode) => {
              if (!selectedOrganizationId) {
                toast.error("Select an organization before linking a GitHub installation.");
                return;
              }

              claimGitHubInstallation.mutate({
                installationId: availableInstallation.installationId,
                organizationId: selectedOrganizationId,
                setupAction: setupMode,
              });
            }}
          />

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

type AvailableGitHubInstallation = {
  installationId: string;
  accountLogin: string | null;
  accountType: string | null;
  repositorySelection: string | null;
  status: string;
  repositoryCount: number;
  repositories: {
    githubRepositoryId: string;
    fullName: string;
    htmlUrl: string | null;
    defaultBranch: string | null;
    private: boolean;
  }[];
  linkStatus: "available" | "linked" | "linked_to_another_organization";
};

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function AvailableInstallationsState({
  configured,
  errorMessage,
  installations,
  isClaiming,
  isLoading,
  pendingInstallationId,
  onLink,
}: {
  configured: boolean;
  errorMessage: string | null;
  installations: AvailableGitHubInstallation[];
  isClaiming: boolean;
  isLoading: boolean;
  pendingInstallationId: string | null;
  onLink: (installation: AvailableGitHubInstallation, setupMode: string) => void;
}) {
  if (!configured) {
    return (
      <p className="text-muted-foreground">
        Reviewer GitHub App is not configured for this environment.
      </p>
    );
  }

  if (isLoading) {
    return <LoadingState label="Checking GitHub App installations" />;
  }

  if (errorMessage) {
    return <p className="text-destructive">{errorMessage}</p>;
  }

  if (installations.length === 0) {
    return (
      <p className="text-muted-foreground">
        GitHub has not returned any installations for this Reviewer app.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {installations.map((installation) => {
        const isPending = isClaiming && pendingInstallationId === installation.installationId;
        const isLinked = installation.linkStatus === "linked";
        const isLinkedElsewhere = installation.linkStatus === "linked_to_another_organization";
        const visibleRepositories = installation.repositories.slice(0, 5);

        return (
          <div
            className="grid gap-3 rounded-md border border-border p-3"
            key={installation.installationId}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-medium">
                  {installation.accountLogin ?? `Installation ${installation.installationId}`}
                </p>
                <p className="text-muted-foreground text-xs">
                  {installation.accountType ?? "GitHub account"} · {installation.status} ·{" "}
                  {installation.repositorySelection ?? "selected"} repos ·{" "}
                  {installation.repositoryCount} available
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={isLinked ? "outline" : "default"}
                disabled={isPending || isLinkedElsewhere}
                onClick={() => onLink(installation, isLinked ? "sync" : "manual_link")}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {isLinked ? "Sync repos" : isLinkedElsewhere ? "Linked elsewhere" : "Link here"}
              </Button>
            </div>

            {visibleRepositories.length > 0 ? (
              <ul className="grid gap-2">
                {visibleRepositories.map((repository) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs"
                    key={repository.githubRepositoryId}
                  >
                    <span>{repository.fullName}</span>
                    <span className="text-muted-foreground">
                      {repository.private ? "Private" : "Public"}
                      {repository.defaultBranch ? ` · ${repository.defaultBranch}` : ""}
                    </span>
                  </li>
                ))}
                {installation.repositories.length > visibleRepositories.length ? (
                  <li className="border-t border-border pt-2 text-muted-foreground text-xs">
                    +{installation.repositories.length - visibleRepositories.length} more
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">
                GitHub returned no repositories for this installation.
              </p>
            )}
          </div>
        );
      })}
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
