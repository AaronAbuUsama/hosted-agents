"use client";

import { useState, type ReactElement } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Section } from "@astryxdesign/core/Section";
import { Selector, SelectorOption } from "@astryxdesign/core/Selector";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useRouter } from "next/navigation";

import { TRIGGER_EVENTS } from "@/components/coworker/reviewer-triggers";
import { notify } from "@/lib/toast-bridge";
import { client } from "@/utils/orpc";

type WorkerConfiguration = Awaited<ReturnType<typeof client.workerConfiguration>>;
type WorkerSkillRecord = WorkerConfiguration["skills"][number];
type GitHubInstallation = Awaited<ReturnType<typeof client.githubInstallations>>[number];
type OpenPullRequest = Awaited<ReturnType<typeof client.openPullRequests>>[number];

type ReviewerClientProps = {
  initialConfiguration: WorkerConfiguration;
  installations: GitHubInstallation[];
};

const SKILLS_PATH = "/app/skills";

// Curated Codex models for the connected OpenAI provider. Runs prefix these
// with "openai-codex/" — only ids the Codex API accepts belong here.
const CODEX_MODELS: { value: string; description: string }[] = [
  { value: "gpt-5.5", description: "Flagship Codex model — platform default" },
  { value: "gpt-5.5-codex", description: "Tuned for agentic coding and review depth" },
  { value: "gpt-5.1-codex", description: "Previous-generation Codex, proven and stable" },
  { value: "gpt-5.1-codex-mini", description: "Fastest and lightest for quick passes" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

export default function ReviewerClient({
  initialConfiguration,
  installations,
}: ReviewerClientProps): ReactElement {
  const [config, setConfig] = useState(initialConfiguration.config);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);

  const skills = initialConfiguration.skills;
  const defaults = initialConfiguration.defaults;
  const repositories = installations
    .filter((installation) => installation.status === "connected")
    .flatMap((installation) => installation.repositories);
  const enabledRepositoryCount = repositories.filter((repository) => repository.selected).length;
  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;

  return (
    <>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={4}>
            <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
              <VStack gap={1}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Heading level={1}>Reviewer</Heading>
                  <Token label="code_review" />
                </HStack>
                <Text type="supporting" color="secondary">
                  Configure the reviewer&apos;s prompt and model, review its attached skills, and
                  request runs on demand.
                </Text>
              </VStack>
              <Button
                label="Request review"
                variant="primary"
                onClick={() => setIsRunDialogOpen(true)}
              />
            </HStack>
          </LayoutHeader>
        }
        end={
          <LayoutPanel padding={4} width={300}>
            <VStack gap={4}>
              <Heading level={3}>Worker facts</Heading>
              <MetadataList label={{ position: "top" }}>
                <MetadataListItem label="Display name">
                  {config?.displayName?.trim() || defaults.displayName}
                </MetadataListItem>
                <MetadataListItem label="Model">
                  {config?.model?.trim() || `${defaults.model} (default)`}
                </MetadataListItem>
                <MetadataListItem label="Triggers">
                  <HStack gap={1} wrap="wrap">
                    {TRIGGER_EVENTS.map((trigger) => (
                      <Token key={trigger} label={trigger} size="sm" />
                    ))}
                  </HStack>
                </MetadataListItem>
                <MetadataListItem label="Repositories">
                  <VStack gap={1}>
                    <Text type="supporting">
                      {enabledRepositoryCount} of {repositories.length} enabled
                    </Text>
                    <Link href="/app/settings" isStandalone>
                      Manage in settings
                    </Link>
                  </VStack>
                </MetadataListItem>
                <MetadataListItem label="Skills">
                  <VStack gap={1}>
                    <Text type="supporting">
                      {enabledSkillCount} of {skills.length} enabled
                    </Text>
                    <Link href={SKILLS_PATH} isStandalone>
                      Manage skills
                    </Link>
                  </VStack>
                </MetadataListItem>
              </MetadataList>
              <Text type="supporting" color="secondary">
                The review protocol (GitHub tools, structured findings, check completion) is fixed
                by the platform. Your prompt and skills extend it.
              </Text>
            </VStack>
          </LayoutPanel>
        }
        content={
          <LayoutContent role="main" isScrollable padding={5}>
            <VStack gap={5}>
              <BasePromptEditor
                key={config?.updatedAt ?? "unset"}
                config={config}
                defaults={defaults}
                onSaved={setConfig}
              />
              <AttachedSkills skills={skills} />
            </VStack>
          </LayoutContent>
        }
      />
      <RequestReviewDialog
        isOpen={isRunDialogOpen}
        onOpenChange={setIsRunDialogOpen}
        installations={installations}
      />
    </>
  );
}

function BasePromptEditor({
  config,
  defaults,
  onSaved,
}: {
  config: WorkerConfiguration["config"];
  defaults: WorkerConfiguration["defaults"];
  onSaved: (config: WorkerConfiguration["config"]) => void;
}): ReactElement {
  const [displayName, setDisplayName] = useState(config?.displayName ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [instructions, setInstructions] = useState(config?.instructions ?? "");
  const [isSaving, setIsSaving] = useState(false);

  // Keep a previously saved free-text model visible even if it left the curated list.
  const modelOptions =
    CODEX_MODELS.some((entry) => entry.value === model) || !model
      ? CODEX_MODELS.map((entry) => ({ value: entry.value, label: entry.value }))
      : [
          ...CODEX_MODELS.map((entry) => ({ value: entry.value, label: entry.value })),
          { value: model, label: model },
        ];

  async function save(): Promise<void> {
    setIsSaving(true);
    try {
      const saved = await client.updateWorkerConfiguration({
        displayName: displayName.trim() || null,
        model: model.trim() || null,
        instructions: instructions.trim() || null,
      });
      onSaved(saved);
      notify({ body: "Reviewer configuration saved. New runs pick it up immediately." });
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Base prompt</Heading>
          <Text type="supporting" color="secondary">
            Organization-level guidance appended to the reviewer&apos;s fixed protocol on every run.
          </Text>
        </VStack>
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <TextInput
              label="Display name"
              value={displayName}
              onChange={(value) => setDisplayName(value)}
              placeholder={defaults.displayName}
              description="Shown on GitHub reviews and checks."
            />
          </StackItem>
          <StackItem size="fill">
            <Selector
              label="Model"
              value={model || null}
              onChange={(value) => setModel(value ?? "")}
              hasClear
              placeholder={`${defaults.model} (default)`}
              description="Codex model used for review runs. Clear to use the platform default."
              options={modelOptions}
              renderOption={(option) => (
                <SelectorOption
                  label={option.label}
                  description={
                    CODEX_MODELS.find((entry) => entry.value === option.value)?.description ??
                    "Custom model id saved earlier"
                  }
                />
              )}
            />
          </StackItem>
        </HStack>
        <TextArea
          label="Review guidance"
          value={instructions}
          onChange={(value) => setInstructions(value)}
          rows={14}
          placeholder={
            "e.g. Focus on data-loss and migration risks first.\nOur API package must stay backwards compatible.\nFlag any new dependency."
          }
          description="Appended to the system prompt as team review guidance."
        />
        <HStack gap={2}>
          <Button
            label={isSaving ? "Saving…" : "Save configuration"}
            variant="primary"
            onClick={() => void save()}
            isDisabled={isSaving}
          />
        </HStack>
      </VStack>
    </Section>
  );
}

// Skills are authored on their own screen; the reviewer shows which bundles are
// attached (all enabled code_review skills load on every run) and links out to
// edit them.
function AttachedSkills({ skills }: { skills: WorkerSkillRecord[] }): ReactElement {
  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Heading level={2}>Attached skills</Heading>
            <Text type="supporting" color="secondary">
              Enabled skill bundles load into the sandbox on every run. Edit them on the Skills
              screen.
            </Text>
          </VStack>
          <Button label="Open Skills" variant="secondary" size="sm" href={SKILLS_PATH} />
        </HStack>
        {skills.length === 0 ? (
          <EmptyState
            title="No skills yet"
            description="Create a skill bundle to extend the reviewer with your team's standards."
            headingLevel={3}
            actions={<Button label="New skill" variant="primary" href={SKILLS_PATH} />}
          />
        ) : (
          <List density="compact" hasDividers>
            {skills.map((skill) => (
              <ListItem
                key={skill.id}
                label={skill.name}
                description={skill.description ?? undefined}
                href={SKILLS_PATH}
                endContent={
                  <HStack gap={1} vAlign="center">
                    <Token
                      label={`${skill.files.length} file${skill.files.length === 1 ? "" : "s"}`}
                      size="sm"
                    />
                    <Token label={skill.enabled ? "enabled" : "off"} size="sm" />
                  </HStack>
                }
              />
            ))}
          </List>
        )}
      </VStack>
    </Section>
  );
}

function RequestReviewDialog({
  isOpen,
  onOpenChange,
  installations,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  installations: GitHubInstallation[];
}): ReactElement {
  const router = useRouter();
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [pullRequests, setPullRequests] = useState<OpenPullRequest[] | null>(null);
  const [isLoadingPullRequests, setIsLoadingPullRequests] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  const repositories = installations
    .filter((installation) => installation.status === "connected")
    .flatMap((installation) => installation.repositories);

  async function selectRepository(nextRepositoryId: string): Promise<void> {
    setRepositoryId(nextRepositoryId);
    setPullRequests(null);
    setSelectedNumber(null);
    setLoadError(null);
    setIsLoadingPullRequests(true);
    try {
      const list = await client.openPullRequests({ repositoryId: nextRepositoryId });
      setPullRequests(list);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setIsLoadingPullRequests(false);
    }
  }

  async function trigger(): Promise<void> {
    if (!repositoryId || selectedNumber === null) {
      return;
    }

    setIsTriggering(true);
    try {
      const run = await client.triggerCodeReviewRun({
        repositoryId,
        pullRequestNumber: selectedNumber,
      });
      notify({ body: `Review queued for PR #${selectedNumber}.` });
      onOpenChange(false);
      router.push(`/app/runs/${run.id}`);
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
      setIsTriggering(false);
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={560} purpose="form">
      <DialogHeader
        title="Request a review"
        subtitle="Queue the reviewer against an open pull request."
        onOpenChange={onOpenChange}
      />
      <VStack gap={4}>
        <Selector
          label="Repository"
          placeholder="Pick a repository"
          value={repositoryId ?? undefined}
          onChange={(value) => void selectRepository(value)}
          options={repositories.map((repository) => ({
            value: repository.id,
            label: repository.selected ? repository.fullName : `${repository.fullName} (disabled)`,
            disabled: !repository.selected,
          }))}
        />

        {isLoadingPullRequests ? (
          <Text type="supporting" color="secondary">
            Loading open pull requests…
          </Text>
        ) : null}

        {loadError ? (
          <Banner status="error" title="Could not load pull requests" description={loadError} />
        ) : null}

        {pullRequests && pullRequests.length === 0 ? (
          <EmptyState
            title="No open pull requests"
            description="This repository has nothing to review right now."
            headingLevel={3}
          />
        ) : null}

        {pullRequests && pullRequests.length > 0 ? (
          <List density="compact" hasDividers header="Open pull requests">
            {pullRequests.map((pullRequest) => (
              <ListItem
                key={pullRequest.number}
                label={`#${pullRequest.number} ${pullRequest.title}`}
                description={[
                  pullRequest.headRef && pullRequest.baseRef
                    ? `${pullRequest.headRef} → ${pullRequest.baseRef}`
                    : null,
                  pullRequest.authorLogin ? `by ${pullRequest.authorLogin}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                isSelected={selectedNumber === pullRequest.number}
                onClick={() => setSelectedNumber(pullRequest.number)}
                endContent={pullRequest.draft ? <Token label="draft" size="sm" /> : undefined}
              />
            ))}
          </List>
        ) : null}

        <HStack gap={2} hAlign="end">
          <Button
            label="Cancel"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            isDisabled={isTriggering}
          />
          <Button
            label={isTriggering ? "Queueing…" : "Request review"}
            variant="primary"
            onClick={() => void trigger()}
            isDisabled={selectedNumber === null || isTriggering}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
