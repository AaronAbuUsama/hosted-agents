"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  CodeBracketSquareIcon,
  FolderIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

import { isCoderInstallation, isReviewerInstallation } from "@/lib/github-installations";
import { client } from "@/utils/orpc";

type GitHubStage = "apps" | "repositories" | "finish";
type AppId = "reviewer" | "coder";
type GitHubInstallation = Awaited<ReturnType<typeof client.githubInstallations>>[number];
type GitHubRepository = GitHubInstallation["repositories"][number];
type CoderAppConfig = Awaited<ReturnType<typeof client.githubCoderAppInstallUrl>>;

export default function GitHubOnboardingPage(): ReactElement {
  const router = useRouter();
  const [stage, setStage] = useState<GitHubStage>("apps");
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [coderAppConfig, setCoderAppConfig] = useState<CoderAppConfig | null>(null);
  const [isLoadingInstallations, setIsLoadingInstallations] = useState(true);
  const [isStartingReviewerInstall, setIsStartingReviewerInstall] = useState(false);
  const [isStartingCoderInstall, setIsStartingCoderInstall] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Classify installations from the server-resolved `workerRole` (see
  // @/lib/github-installations) rather than the admin-gated Coder install-config
  // call. `githubInstallations` is available to every member, so a non-admin (for
  // whom `githubCoderAppInstallUrl` is FORBIDDEN and swallowed to null) still sees
  // the reviewer app and its repositories.
  const coderInstallation = useMemo(
    () => installations.find(isCoderInstallation) ?? null,
    [installations],
  );
  const reviewerInstallation = useMemo(
    () => installations.find(isReviewerInstallation) ?? null,
    [installations],
  );
  const linkedRepositories = useMemo(
    () =>
      installations
        .filter(isReviewerInstallation)
        .flatMap((installation) => installation.repositories),
    [installations],
  );
  const accountLabel = reviewerInstallation?.accountLogin ?? "GitHub account linked on callback";
  const isCoderConfigured = coderAppConfig?.configured ?? false;
  const isCoderConnected = Boolean(coderInstallation);
  const coderAccountLabel = coderInstallation?.accountLogin ?? accountLabel;
  const areAppsConnected = Boolean(reviewerInstallation);
  const areRepositoriesValidated = linkedRepositories.length > 0;

  const loadInstallations = useCallback(async () => {
    setIsLoadingInstallations(true);
    setSetupError(null);

    try {
      const [installationList, coderConfig] = await Promise.all([
        client.githubInstallations({}),
        client.githubCoderAppInstallUrl({}).catch(() => null),
      ]);
      setInstallations(installationList);
      setCoderAppConfig(coderConfig);
    } catch (error) {
      setSetupError(
        error instanceof Error ? error.message : "Unable to load GitHub installations.",
      );
    } finally {
      setIsLoadingInstallations(false);
    }
  }, []);

  useEffect(() => {
    void loadInstallations();
  }, [loadInstallations]);

  async function connectReviewerApp(): Promise<void> {
    setIsStartingReviewerInstall(true);
    setSetupError(null);

    try {
      const result = await client.githubAppInstallUrl({});

      if (!result.configured || !result.installUrl) {
        setSetupError("Reviewer GitHub App is not configured for this environment.");
        setIsStartingReviewerInstall(false);
        return;
      }

      window.location.assign(result.installUrl);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to start GitHub install.");
      setIsStartingReviewerInstall(false);
    }
  }

  async function connectCoderApp(): Promise<void> {
    setIsStartingCoderInstall(true);
    setSetupError(null);

    try {
      const result = await client.githubCoderAppInstallUrl({});

      if (!result.configured || !result.installUrl) {
        setSetupError("Coder GitHub App is not configured for this environment.");
        setIsStartingCoderInstall(false);
        return;
      }

      window.location.assign(result.installUrl);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to start GitHub install.");
      setIsStartingCoderInstall(false);
    }
  }

  return (
    <main className="min-h-dvh bg-body p-6 text-primary">
      <VStack gap={6} className="mx-auto w-full max-w-6xl">
        <HStack hAlign="between" vAlign="center" wrap="wrap">
          <Link href="/" isStandalone>
            Coworker
          </Link>
          <Text type="supporting" color="secondary">
            GitHub setup
          </Text>
        </HStack>

        <Section variant="section" padding={0}>
          <VStack gap={0}>
            <section className="border-b border-border px-5 py-4">
              <HStack gap={4} wrap="wrap">
                <ProgressItem
                  label="Connect app"
                  isActive={stage === "apps"}
                  isComplete={areAppsConnected}
                />
                <ProgressItem
                  label="Validate repos"
                  isActive={stage === "repositories"}
                  isComplete={areRepositoriesValidated}
                />
                <ProgressItem label="Finish" isActive={stage === "finish"} isComplete={false} />
              </HStack>
            </section>

            <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={0} align="stretch">
              <section className="border-b border-border p-5 lg:border-b-0 lg:border-r">
                <VStack gap={4}>
                  <VStack gap={1}>
                    <Text type="label" color="accent">
                      Onboarding
                    </Text>
                    <Heading level={1}>{stageTitle(stage)}</Heading>
                  </VStack>
                  <Text type="large" color="secondary" as="p">
                    {stageDescription(stage)}
                  </Text>
                  <StageActions
                    stage={stage}
                    areAppsConnected={areAppsConnected}
                    areRepositoriesValidated={areRepositoriesValidated}
                    onBack={() => setStage(stage === "finish" ? "repositories" : "apps")}
                    onNext={() => {
                      if (stage === "apps") {
                        setStage("repositories");
                        return;
                      }
                      if (stage === "repositories") {
                        setStage("finish");
                        return;
                      }
                      router.push("/app");
                    }}
                  />
                </VStack>
              </section>

              <Section variant="muted" padding={5}>
                {stage === "apps" ? (
                  <AppsPanel
                    accountLabel={accountLabel}
                    coderAccountLabel={coderAccountLabel}
                    installError={setupError}
                    isCoderConfigured={isCoderConfigured}
                    isCoderConnected={isCoderConnected}
                    isLoadingInstallations={isLoadingInstallations}
                    isReviewerConnected={areAppsConnected}
                    isStartingCoderInstall={isStartingCoderInstall}
                    isStartingReviewerInstall={isStartingReviewerInstall}
                    onConnectCoder={connectCoderApp}
                    onConnectReviewer={connectReviewerApp}
                    onRefresh={loadInstallations}
                  />
                ) : stage === "repositories" ? (
                  <RepositoriesPanel
                    installError={setupError}
                    isLoading={isLoadingInstallations}
                    onRefresh={loadInstallations}
                    repositories={linkedRepositories}
                  />
                ) : (
                  <FinishPanel
                    accountLabel={accountLabel}
                    coderValue={
                      isCoderConnected
                        ? "Connected"
                        : isCoderConfigured
                          ? "Available to connect"
                          : "Not configured for this environment"
                    }
                    repositoryCount={linkedRepositories.length}
                  />
                )}
              </Section>
            </Grid>
          </VStack>
        </Section>
      </VStack>
    </main>
  );
}

function stageTitle(stage: GitHubStage): string {
  if (stage === "repositories") {
    return "Validate repositories";
  }
  if (stage === "finish") {
    return "GitHub is ready";
  }
  return "Connect required apps";
}

function stageDescription(stage: GitHubStage): string {
  if (stage === "repositories") {
    return "Coworker reads repositories from the linked reviewer GitHub App installation.";
  }
  if (stage === "finish") {
    return "The reviewer app is connected. Connect the coder app to let it open implementation pull requests.";
  }
  return "Connect the reviewer GitHub App, then connect the coder app so it can open pull requests under its own identity.";
}

function StageActions({
  stage,
  areAppsConnected,
  areRepositoriesValidated,
  onBack,
  onNext,
}: {
  stage: GitHubStage;
  areAppsConnected: boolean;
  areRepositoriesValidated: boolean;
  onBack: () => void;
  onNext: () => void;
}): ReactElement {
  const isNextDisabled =
    (stage === "apps" && !areAppsConnected) ||
    (stage === "repositories" && !areRepositoriesValidated);

  return (
    <HStack gap={3} wrap="wrap">
      {stage !== "apps" ? (
        <Button
          label="Back"
          variant="secondary"
          icon={<Icon icon={ArrowLeftIcon} size="sm" />}
          onClick={onBack}
        />
      ) : null}
      <Button
        label={stage === "finish" ? "Enter workspace" : "Continue"}
        variant="primary"
        icon={<Icon icon={ArrowRightIcon} size="sm" />}
        isDisabled={isNextDisabled}
        onClick={onNext}
      />
    </HStack>
  );
}

function ProgressItem({
  label,
  isActive,
  isComplete,
}: {
  label: string;
  isActive: boolean;
  isComplete: boolean;
}): ReactElement {
  return (
    <HStack gap={1.5} vAlign="center">
      <Text
        type="supporting"
        color={isActive ? "primary" : "secondary"}
        weight={isActive ? "semibold" : undefined}
      >
        {label}
      </Text>
      {isComplete || isActive ? (
        <Token label={isComplete ? "Done" : "Current"} size="sm" color="gray" />
      ) : null}
    </HStack>
  );
}

function AppsPanel({
  accountLabel,
  coderAccountLabel,
  installError,
  isCoderConfigured,
  isCoderConnected,
  isLoadingInstallations,
  isReviewerConnected,
  isStartingCoderInstall,
  isStartingReviewerInstall,
  onConnectCoder,
  onConnectReviewer,
  onRefresh,
}: {
  accountLabel: string;
  coderAccountLabel: string;
  installError: string | null;
  isCoderConfigured: boolean;
  isCoderConnected: boolean;
  isLoadingInstallations: boolean;
  isReviewerConnected: boolean;
  isStartingCoderInstall: boolean;
  isStartingReviewerInstall: boolean;
  onConnectCoder: () => void;
  onConnectReviewer: () => void;
  onRefresh: () => void;
}): ReactElement {
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={2}>GitHub Apps</Heading>
          <Text type="supporting" color="secondary" as="p">
            The reviewer app reviews pull requests; the coder app opens implementation pull requests
            under its own identity. Connect each app to its GitHub App installation.
          </Text>
        </VStack>
        <AccountToken label={isReviewerConnected ? accountLabel : null} />
      </HStack>

      <VStack gap={3}>
        <AppConnectionCard
          appId="reviewer"
          title="Reviewer app"
          detail="Reviews pull requests, leaves comments, and posts checks."
          accountLabel={accountLabel}
          isConnected={isReviewerConnected}
          isLoading={isStartingReviewerInstall}
          onConnect={onConnectReviewer}
          statusLabel={isReviewerConnected ? "Connected" : "Required"}
        />
        <AppConnectionCard
          appId="coder"
          title="Coder app"
          detail="Responds to issue labels and prepares implementation pull requests."
          accountLabel={
            isCoderConnected
              ? coderAccountLabel
              : isCoderConfigured
                ? "No coder GitHub App installation linked yet"
                : "Coder GitHub App is not configured for this environment"
          }
          disabledMessage="Coder GitHub App is not configured for this environment."
          isConnected={isCoderConnected}
          isDisabled={!isCoderConfigured}
          isLoading={isStartingCoderInstall}
          onConnect={onConnectCoder}
          statusLabel={
            isCoderConnected ? "Connected" : isCoderConfigured ? "Required" : "Not configured"
          }
        />
      </VStack>
      {installError ? (
        <VStack gap={2}>
          <Text type="supporting" color="secondary" as="p">
            {installError}
          </Text>
          <Button label="Refresh GitHub setup" variant="secondary" onClick={onRefresh} />
        </VStack>
      ) : null}
      {isLoadingInstallations ? (
        <Text type="supporting" color="secondary" as="p">
          Checking linked GitHub installations...
        </Text>
      ) : null}
    </VStack>
  );
}

function AccountToken({ label }: { label: string | null }): ReactElement | null {
  if (!label) {
    return null;
  }

  return <Token label={label} />;
}

function AppConnectionCard({
  appId,
  title,
  detail,
  accountLabel,
  disabledMessage,
  isConnected,
  isDisabled = false,
  isLoading = false,
  onConnect,
  statusLabel,
}: {
  appId: AppId;
  title: string;
  detail: string;
  accountLabel: string;
  disabledMessage?: string;
  isConnected: boolean;
  isDisabled?: boolean;
  isLoading?: boolean;
  onConnect?: () => void;
  statusLabel: string;
}): ReactElement {
  return (
    <section className="rounded-lg border border-border bg-body p-4">
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="start" gap={3} wrap="wrap">
          <HStack gap={3} vAlign="start">
            <Icon
              icon={appId === "reviewer" ? ShieldCheckIcon : CodeBracketSquareIcon}
              size="sm"
              color="secondary"
            />
            <VStack gap={0.5}>
              <Text weight="semibold">{title}</Text>
              <Text type="supporting" color="secondary">
                {detail}
              </Text>
            </VStack>
          </HStack>
          <Token label={statusLabel} size="sm" color="gray" />
        </HStack>
        <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Icon icon={UserCircleIcon} size="sm" color="secondary" />
            <Text type="supporting" color="secondary">
              {isConnected ? accountLabel : (disabledMessage ?? "No GitHub account linked")}
            </Text>
          </HStack>
          {isConnected ? null : (
            <Button
              label={isLoading ? "Opening GitHub" : `Connect ${appId} app`}
              variant="primary"
              icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
              isDisabled={isDisabled || isLoading}
              isLoading={isLoading}
              onClick={onConnect}
            />
          )}
        </HStack>
      </VStack>
    </section>
  );
}

function RepositoriesPanel({
  installError,
  isLoading,
  onRefresh,
  repositories,
}: {
  installError: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  repositories: GitHubRepository[];
}): ReactElement {
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={2}>Linked repositories</Heading>
          <Text type="supporting" color="secondary" as="p">
            These repositories are loaded from the reviewer GitHub App installation record.
          </Text>
        </VStack>
        <Token
          label={
            isLoading
              ? "Loading"
              : repositories.length
                ? `${repositories.length} linked`
                : "No repos"
          }
          color="gray"
        />
      </HStack>

      {installError ? (
        <VStack gap={2}>
          <Text type="supporting" color="secondary" as="p">
            {installError}
          </Text>
          <Button label="Refresh repositories" variant="secondary" onClick={onRefresh} />
        </VStack>
      ) : null}

      {isLoading ? (
        <Text type="supporting" color="secondary" as="p">
          Loading linked repositories...
        </Text>
      ) : repositories.length ? (
        <VStack gap={3}>
          {repositories.map((repository) => (
            <RepositoryValidationCard key={repository.id} repository={repository} />
          ))}
        </VStack>
      ) : (
        <VStack gap={2}>
          <Text type="body" weight="semibold">
            No repositories linked yet
          </Text>
          <Text type="supporting" color="secondary" as="p">
            Install the reviewer GitHub App on at least one repository, then return to this step.
          </Text>
        </VStack>
      )}
    </VStack>
  );
}

function RepositoryValidationCard({ repository }: { repository: GitHubRepository }): ReactElement {
  return (
    <section className="rounded-lg border border-border bg-body p-4">
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="start" gap={3} wrap="wrap">
          <HStack gap={3} vAlign="start">
            <Icon icon={FolderIcon} size="sm" color="secondary" />
            <VStack gap={0.5}>
              <Text weight="semibold">{repository.fullName}</Text>
              <Text type="supporting" color="secondary">
                Default branch: {repository.defaultBranch ?? "not reported"}
              </Text>
            </VStack>
          </HStack>
          <Token label={repository.selected ? "Selected" : "Installed"} size="sm" color="gray" />
        </HStack>
        <HStack gap={2} wrap="wrap">
          <Token label="Reviewer app" />
          <Token label={repository.private ? "Private" : "Public"} />
          <Token label="Label checks follow-up" />
        </HStack>
      </VStack>
    </section>
  );
}

function FinishPanel({
  accountLabel,
  coderValue,
  repositoryCount,
}: {
  accountLabel: string;
  coderValue: string;
  repositoryCount: number;
}): ReactElement {
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={2}>Ready</Heading>
          <Text type="supporting" color="secondary" as="p">
            The reviewer app is connected and repositories are available to the workspace.
          </Text>
        </VStack>
        <Token label="Complete" color="gray" />
      </HStack>
      <VStack gap={3}>
        <SummaryRow label="GitHub account" value={accountLabel} />
        <SummaryRow label="Reviewer app" value="Connected" />
        <SummaryRow label="Coder app" value={coderValue} />
        <SummaryRow label="Repositories" value={`${repositoryCount} linked`} />
        <SummaryRow label="Label and rule validation" value="Follow-up backend wiring" />
      </VStack>
    </VStack>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
      <Text type="supporting" color="secondary">
        {label}
      </Text>
      <Text weight="semibold">{value}</Text>
    </HStack>
  );
}
