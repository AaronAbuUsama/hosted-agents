"use client";

import { useState, type ReactElement } from "react";

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

import { projects, type Project } from "@/lib/coworker-data";

type GitHubStage = "apps" | "repositories" | "finish";
type AppId = "reviewer" | "coder";

const githubAccount = {
  owner: "Capxul Alpha",
  account: "capxul",
};

const requiredLabels = ["coworker:review", "coworker:implement"];

export default function GitHubOnboardingPage(): ReactElement {
  const router = useRouter();
  const [stage, setStage] = useState<GitHubStage>("apps");
  const [connectedApps, setConnectedApps] = useState<Record<AppId, boolean>>({
    reviewer: false,
    coder: false,
  });
  const areAppsConnected = connectedApps.reviewer && connectedApps.coder;
  const areRepositoriesValidated = areAppsConnected;

  function connectApp(appId: AppId): void {
    setConnectedApps((current) => ({ ...current, [appId]: true }));
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
                  label="Connect apps"
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
                  <AppsPanel connectedApps={connectedApps} onConnectApp={connectApp} />
                ) : stage === "repositories" ? (
                  <RepositoriesPanel />
                ) : (
                  <FinishPanel />
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
    return "Coworker reads the GitHub installation, then validates app coverage and required labels.";
  }
  if (stage === "finish") {
    return "Both apps are connected and the linked repositories have the required setup.";
  }
  return "Connect the reviewer app and coder app to the same GitHub account.";
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
  connectedApps,
  onConnectApp,
}: {
  connectedApps: Record<AppId, boolean>;
  onConnectApp: (appId: AppId) => void;
}): ReactElement {
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={2}>GitHub Apps</Heading>
          <Text type="supporting" color="secondary" as="p">
            Both apps are required before repositories can be validated.
          </Text>
        </VStack>
        <AccountToken isVisible={connectedApps.reviewer || connectedApps.coder} />
      </HStack>

      <VStack gap={3}>
        <AppConnectionCard
          appId="reviewer"
          title="Reviewer app"
          detail="Reviews pull requests, leaves comments, and posts checks."
          isConnected={connectedApps.reviewer}
          onConnect={onConnectApp}
        />
        <AppConnectionCard
          appId="coder"
          title="Coder app"
          detail="Responds to issue labels and prepares implementation pull requests."
          isConnected={connectedApps.coder}
          onConnect={onConnectApp}
        />
      </VStack>
    </VStack>
  );
}

function AccountToken({ isVisible }: { isVisible: boolean }): ReactElement | null {
  if (!isVisible) {
    return null;
  }

  return <Token label={`${githubAccount.owner} / ${githubAccount.account}`} />;
}

function AppConnectionCard({
  appId,
  title,
  detail,
  isConnected,
  onConnect,
}: {
  appId: AppId;
  title: string;
  detail: string;
  isConnected: boolean;
  onConnect: (appId: AppId) => void;
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
          <Token label={isConnected ? "Connected" : "Required"} size="sm" color="gray" />
        </HStack>
        <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Icon icon={UserCircleIcon} size="sm" color="secondary" />
            <Text type="supporting" color="secondary">
              {isConnected
                ? `${githubAccount.owner} / ${githubAccount.account}`
                : "No GitHub account linked"}
            </Text>
          </HStack>
          {isConnected ? null : (
            <Button
              label={`Connect ${appId} app`}
              variant="primary"
              icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
              onClick={() => onConnect(appId)}
            />
          )}
        </HStack>
      </VStack>
    </section>
  );
}

function RepositoriesPanel(): ReactElement {
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={2}>Linked repositories</Heading>
          <Text type="supporting" color="secondary" as="p">
            These repositories come from the GitHub App installation and are checked automatically.
          </Text>
        </VStack>
        <Token label="Automatically validated" color="gray" />
      </HStack>

      <VStack gap={3}>
        {projects.map((project) => (
          <RepositoryValidationCard key={project.id} project={project} />
        ))}
      </VStack>
    </VStack>
  );
}

function RepositoryValidationCard({ project }: { project: Project }): ReactElement {
  return (
    <section className="rounded-lg border border-border bg-body p-4">
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="start" gap={3} wrap="wrap">
          <HStack gap={3} vAlign="start">
            <Icon icon={FolderIcon} size="sm" color="secondary" />
            <VStack gap={0.5}>
              <Text weight="semibold">{project.name}</Text>
              <Text type="supporting" color="secondary">
                {githubAccount.account} / {project.branches.join(", ")}
              </Text>
            </VStack>
          </HStack>
          <Token label="Ready" size="sm" color="gray" />
        </HStack>
        <HStack gap={2} wrap="wrap">
          <Token label="Reviewer app" />
          <Token label="Coder app" />
          {requiredLabels.map((label) => (
            <Token key={label} label={label} />
          ))}
        </HStack>
      </VStack>
    </section>
  );
}

function FinishPanel(): ReactElement {
  return (
    <VStack gap={5}>
      <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={2}>Ready</Heading>
          <Text type="supporting" color="secondary" as="p">
            The reviewer and coder apps are connected to the same GitHub account.
          </Text>
        </VStack>
        <Token label="Complete" color="gray" />
      </HStack>
      <VStack gap={3}>
        <SummaryRow
          label="GitHub account"
          value={`${githubAccount.owner} / ${githubAccount.account}`}
        />
        <SummaryRow label="Apps" value="Reviewer app, Coder app" />
        <SummaryRow label="Required labels" value={requiredLabels.join(", ")} />
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
