"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";

import { SettingsRow, SettingsRows } from "@/components/coworker/settings-rows";
import { authClient } from "@/lib/auth-client";
import { isReviewerInstallation } from "@/lib/github-installations";
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
}: GitHubSetupClientProps): ReactElement {
  const showToast = useToast();
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
  // This flow provisions the reviewer app; the Coder app is linked from the
  // onboarding GitHub step. Scope the "reviewer linked" summary to reviewer-app
  // installations so a linked Coder app is never counted as a reviewer install.
  const reviewerInstallations = installations.filter(isReviewerInstallation);
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
  const linkedInstallationIds = new Set(
    (linkedInstallationData ?? []).map((installation) => installation.installationId),
  );
  // The GitHub API lists every installation of the app; only offer the ones
  // that are not already linked to this organization so the two lists never
  // show the same installation twice.
  const availableInstallations = (availableInstallationData?.installations ?? []).filter(
    (installation) => !linkedInstallationIds.has(installation.installationId),
  );
  const isGitHubAppConfigured = availableInstallationData?.configured ?? true;
  const linkedRepositoryCount = reviewerInstallations.reduce(
    (count, installation) => count + installation.repositoryCount,
    0,
  );
  const startReviewerInstall = async () => {
    if (!selectedOrganizationId) {
      showToast({
        body: "Select an organization before installing the Reviewer GitHub App.",
        type: "error",
      });
      return;
    }

    setIsStartingReviewerInstall(true);

    try {
      const result = await client.githubAppInstallUrl({ organizationId: selectedOrganizationId });

      if (!result.configured || !result.installUrl) {
        showToast({
          body: "Reviewer GitHub App is not configured for this environment.",
          type: "error",
        });
        setIsStartingReviewerInstall(false);
        return;
      }

      window.location.assign(result.installUrl);
    } catch (error) {
      showToast({
        body: error instanceof Error ? error.message : "Unable to start GitHub install.",
        type: "error",
      });
      setIsStartingReviewerInstall(false);
    }
  };
  const claimGitHubInstallation = useMutation(
    orpc.claimGitHubInstallation.mutationOptions({
      onSuccess: (result) => {
        showToast({ body: `GitHub installation linked with ${result.repositoryCount} repos` });
        void refetchLinkedInstallations();
        void refetchAvailableInstallations();
      },
      onError: (error) => {
        showToast({ body: error.message, type: "error" });
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
  const hasLinkedReviewer = reviewerInstallations.length > 0;
  const canContinueToProvider = hasLinkedReviewer || claimGitHubInstallation.isSuccess;
  const pendingInstallationId = claimGitHubInstallation.variables?.installationId ?? null;
  const refreshGitHubState = () => {
    void refetchLinkedInstallations();
    void refetchAvailableInstallations();
  };

  return (
    <VStack gap={5}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Icon icon={CodeBracketIcon} size="sm" />
          <Text weight="semibold">
            {installationId
              ? `GitHub returned installation ${installationId}`
              : "Install or verify the Reviewer GitHub App"}
          </Text>
        </HStack>
        {setupAction ? (
          <Text type="supporting" color="secondary">
            Action: {setupAction}
          </Text>
        ) : null}
        {selectedOrganization ? (
          <Text type="supporting" color="secondary">
            Linking into {selectedOrganization.name}. This Coworker organization can use
            repositories from multiple GitHub App installations.
          </Text>
        ) : null}
      </VStack>

      {organizationList.length > 0 ? (
        <Selector
          label="Organization"
          placeholder="Select an organization"
          options={organizationList.map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
          value={selectedOrganizationId}
          onChange={(value) => {
            attemptedClaim.current = false;
            setSelectedOrganizationId(value);
          }}
        />
      ) : organizations.isPending ? (
        <LoadingState label="Loading organizations" />
      ) : (
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Create an organization before installing the Reviewer GitHub App.
          </Text>
          <Button label="Create organization" href="/onboarding/organization" variant="secondary" />
        </VStack>
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

      <VStack gap={3}>
        {hasLinkedReviewer ? (
          <HStack gap={2} vAlign="center">
            <Icon icon={CheckCircleIcon} size="sm" />
            <Text color="secondary">
              Reviewer app linked with {linkedRepositoryCount} repositories
            </Text>
          </HStack>
        ) : isLoadingLinkedState ? (
          <LoadingState label="Checking linked GitHub installations" />
        ) : (
          <Text type="supporting" color="secondary">
            No Reviewer GitHub App installation is linked to this Coworker organization yet.
          </Text>
        )}

        <HStack gap={2} wrap="wrap">
          <Button
            label={hasLinkedReviewer ? "Configure on GitHub" : "Install or configure on GitHub"}
            variant="primary"
            icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
            isLoading={isStartingReviewerInstall}
            isDisabled={!selectedOrganizationId}
            onClick={() => void startReviewerInstall()}
          />
          <Button
            label="Refresh"
            variant="secondary"
            icon={<Icon icon={ArrowPathIcon} size="sm" />}
            isLoading={isLoadingAvailableState}
            isDisabled={!selectedOrganizationId}
            onClick={refreshGitHubState}
          />
        </HStack>
      </VStack>

      {!isGitHubAppConfigured ||
      isAvailableInstallationsError ||
      availableInstallations.length > 0 ? (
        <AvailableInstallationsState
          configured={isGitHubAppConfigured}
          errorMessage={isAvailableInstallationsError ? availableInstallationsError.message : null}
          installations={availableInstallations}
          isClaiming={claimGitHubInstallation.isPending}
          isLoading={isLoadingAvailableState}
          pendingInstallationId={pendingInstallationId}
          onLink={(availableInstallation, setupMode) => {
            if (!selectedOrganizationId) {
              showToast({
                body: "Select an organization before linking a GitHub installation.",
                type: "error",
              });
              return;
            }

            claimGitHubInstallation.mutate({
              installationId: availableInstallation.installationId,
              organizationId: selectedOrganizationId,
              setupAction: setupMode,
            });
          }}
        />
      ) : null}

      {isLinkedInstallationsError ? (
        <Banner
          status="error"
          title="Linked installations failed to load"
          description={linkedInstallationsError.message}
          container="section"
        />
      ) : null}

      {hasLinkedReviewer ? <LinkedReviewerState installations={reviewerInstallations} /> : null}

      <HStack gap={2} wrap="wrap">
        <Button
          label="Continue to provider credentials"
          variant="primary"
          href={canContinueToProvider ? "/onboarding/provider" : undefined}
          isDisabled={!canContinueToProvider}
        />
        <Button label="Open runs" variant="secondary" href="/app/runs" />
      </HStack>
    </VStack>
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

function LoadingState({ label }: { label: string }): ReactElement {
  return <Spinner size="sm" label={label} />;
}

function repositoryDescription(repository: {
  private: boolean;
  defaultBranch: string | null;
}): string {
  return `${repository.private ? "Private" : "Public"}${
    repository.defaultBranch ? ` · ${repository.defaultBranch}` : ""
  }`;
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
}): ReactElement {
  if (!configured) {
    return (
      <Text type="supporting" color="secondary">
        Reviewer GitHub App is not configured for this environment.
      </Text>
    );
  }

  if (isLoading) {
    return <LoadingState label="Checking GitHub App installations" />;
  }

  if (errorMessage) {
    return (
      <Banner
        status="error"
        title="GitHub App installations failed to load"
        description={errorMessage}
        container="section"
      />
    );
  }

  if (installations.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        GitHub has not returned any installations for this Reviewer app.
      </Text>
    );
  }

  return (
    <VStack gap={3}>
      {installations.map((installation) => {
        const isPending = isClaiming && pendingInstallationId === installation.installationId;
        const isLinked = installation.linkStatus === "linked";
        const isLinkedElsewhere = installation.linkStatus === "linked_to_another_organization";
        const visibleRepositories = installation.repositories.slice(0, 5);
        const overflow = installation.repositories.length - visibleRepositories.length;

        return (
          <Card key={installation.installationId} padding={3}>
            <VStack gap={3}>
              <HStack gap={3} vAlign="start" hAlign="between" wrap="wrap">
                <StackItem size="fill">
                  <VStack gap={0}>
                    <Text weight="semibold">
                      {installation.accountLogin ?? `Installation ${installation.installationId}`}
                    </Text>
                    <Text type="supporting" color="secondary">
                      {installation.accountType ?? "GitHub account"} · {installation.status} ·{" "}
                      {installation.repositorySelection ?? "selected"} repos ·{" "}
                      {installation.repositoryCount} available
                    </Text>
                  </VStack>
                </StackItem>
                <Button
                  label={
                    isLinked ? "Sync repos" : isLinkedElsewhere ? "Linked elsewhere" : "Link here"
                  }
                  size="sm"
                  variant={isLinked ? "secondary" : "primary"}
                  isLoading={isPending}
                  isDisabled={isPending || isLinkedElsewhere}
                  onClick={() => onLink(installation, isLinked ? "sync" : "manual_link")}
                />
              </HStack>

              {visibleRepositories.length > 0 ? (
                <SettingsRows>
                  {visibleRepositories.map((repository, index) => (
                    <SettingsRow
                      key={repository.githubRepositoryId}
                      label={repository.fullName}
                      value={repositoryDescription(repository)}
                      isLast={index === visibleRepositories.length - 1 && overflow <= 0}
                    />
                  ))}
                  {overflow > 0 ? <SettingsRow label={`+${overflow} more`} isLast /> : null}
                </SettingsRows>
              ) : (
                <Text type="supporting" color="secondary">
                  GitHub returned no repositories for this installation.
                </Text>
              )}
            </VStack>
          </Card>
        );
      })}
    </VStack>
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
}): ReactElement | null {
  if (isPending) {
    return <LoadingState label="Linking GitHub installation" />;
  }

  if (isSuccess) {
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={CheckCircleIcon} size="sm" />
        <Text color="secondary">Linked {repositoryCount} repositories</Text>
      </HStack>
    );
  }

  if (errorMessage) {
    return (
      <VStack gap={2}>
        <Banner
          status="error"
          title="Could not link installation"
          description={errorMessage}
          container="section"
        />
        <Button label="Retry" variant="secondary" isDisabled={!canRetry} onClick={onRetry} />
      </VStack>
    );
  }

  return null;
}

function LinkedReviewerState({
  installations,
}: {
  installations: LinkedGitHubInstallation[];
}): ReactElement {
  return (
    <VStack gap={3}>
      {installations.map((installation) => (
        <Card key={installation.id} padding={3}>
          <VStack gap={3}>
            <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={0}>
                  <Text weight="semibold">
                    {installation.accountLogin ?? "GitHub installation"}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {installation.status} · {installation.repositorySelection ?? "selected"} repos ·{" "}
                    {installation.repositoryCount} persisted
                  </Text>
                </VStack>
              </StackItem>
              <Icon icon={CheckCircleIcon} size="sm" />
            </HStack>

            {installation.repositories.length > 0 ? (
              <SettingsRows>
                {installation.repositories.map((repository, index) => (
                  <SettingsRow
                    key={repository.id}
                    label={repository.fullName}
                    value={repositoryDescription(repository)}
                    isLast={index === installation.repositories.length - 1}
                  />
                ))}
              </SettingsRows>
            ) : (
              <Text type="supporting" color="secondary">
                GitHub returned no repositories for this installation.
              </Text>
            )}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
