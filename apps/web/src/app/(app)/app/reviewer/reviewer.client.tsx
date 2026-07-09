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
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/toast-bridge";

import { TRIGGER_EVENTS } from "@/components/coworker/reviewer-triggers";
import { client } from "@/utils/orpc";

type WorkerConfiguration = Awaited<ReturnType<typeof client.workerConfiguration>>;
type WorkerSkillRecord = WorkerConfiguration["skills"][number];
type GitHubInstallation = Awaited<ReturnType<typeof client.githubInstallations>>[number];
type OpenPullRequest = Awaited<ReturnType<typeof client.openPullRequests>>[number];

type ReviewerClientProps = {
  initialConfiguration: WorkerConfiguration;
  installations: GitHubInstallation[];
};

type EditorSelection = { kind: "prompt" } | { kind: "skill"; name: string } | { kind: "new" };

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

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
  const [skills, setSkills] = useState<WorkerSkillRecord[]>(initialConfiguration.skills);
  const [selection, setSelection] = useState<EditorSelection>({ kind: "prompt" });
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);

  const defaults = initialConfiguration.defaults;
  const repositories = installations
    .filter((installation) => installation.status === "connected")
    .flatMap((installation) => installation.repositories);
  const enabledRepositoryCount = repositories.filter((repository) => repository.selected).length;
  const selectedSkill =
    selection.kind === "skill"
      ? (skills.find((skill) => skill.name === selection.name) ?? null)
      : null;

  function upsertLocalSkill(saved: WorkerSkillRecord): void {
    setSkills((current) => {
      const exists = current.some((skill) => skill.name === saved.name);
      const next = exists
        ? current.map((skill) => (skill.name === saved.name ? saved : skill))
        : [...current, saved];
      return [...next].sort((left, right) => left.name.localeCompare(right.name));
    });
  }

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
                  Configure how the reviewer works, manage its skills, and request runs on demand.
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
        start={
          <LayoutPanel padding={2} width={260}>
            <VStack gap={4}>
              <List density="compact" header="Prompt">
                <ListItem
                  label="Base prompt"
                  description="Instructions and model"
                  isSelected={selection.kind === "prompt"}
                  onClick={() => setSelection({ kind: "prompt" })}
                />
              </List>
              <List density="compact" header="Skills">
                {skills.map((skill) => (
                  <ListItem
                    key={skill.id}
                    label={skill.name}
                    description={skill.enabled ? (skill.description ?? undefined) : "Disabled"}
                    isSelected={selection.kind === "skill" && selection.name === skill.name}
                    onClick={() => setSelection({ kind: "skill", name: skill.name })}
                    endContent={skill.enabled ? undefined : <Token label="off" size="sm" />}
                  />
                ))}
                <ListItem
                  label="New skill…"
                  isSelected={selection.kind === "new"}
                  onClick={() => setSelection({ kind: "new" })}
                />
              </List>
            </VStack>
          </LayoutPanel>
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
                  {`${skills.filter((skill) => skill.enabled).length} enabled`}
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
            {selection.kind === "prompt" ? (
              <BasePromptEditor
                key={config?.updatedAt ?? "unset"}
                config={config}
                defaults={defaults}
                onSaved={setConfig}
              />
            ) : null}
            {selection.kind === "skill" && selectedSkill ? (
              <SkillEditor
                key={selectedSkill.id}
                skill={selectedSkill}
                onSaved={upsertLocalSkill}
                onDeleted={(name) => {
                  setSkills((current) => current.filter((skill) => skill.name !== name));
                  setSelection({ kind: "prompt" });
                }}
              />
            ) : null}
            {selection.kind === "new" ? (
              <NewSkillEditor
                existingNames={skills.map((skill) => skill.name)}
                onCreated={(created) => {
                  upsertLocalSkill(created);
                  setSelection({ kind: "skill", name: created.name });
                }}
              />
            ) : null}
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

function SkillEditor({
  skill,
  onSaved,
  onDeleted,
}: {
  skill: WorkerSkillRecord;
  onSaved: (skill: WorkerSkillRecord) => void;
  onDeleted: (name: string) => void;
}): ReactElement {
  const [description, setDescription] = useState(skill.description ?? "");
  const [content, setContent] = useState(skill.content);
  const [enabled, setEnabled] = useState(skill.enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function save(): Promise<void> {
    setIsSaving(true);
    try {
      const saved = await client.saveWorkerSkill({
        name: skill.name,
        description: description.trim() || undefined,
        content,
        enabled,
      });
      onSaved(saved);
      notify({ body: `Skill ${skill.name} saved.` });
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(): Promise<void> {
    setIsDeleting(true);
    try {
      await client.deleteWorkerSkill({ name: skill.name });
      notify({ body: `Skill ${skill.name} deleted.` });
      onDeleted(skill.name);
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
      setIsDeleting(false);
    }
  }

  return (
    <Section variant="section" padding={4}>
      <VStack gap={4}>
        <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Heading level={2}>{skill.name}</Heading>
            <Text type="supporting" color="secondary">
              Uploaded into the sandbox as skills/{skill.name} before each run.
            </Text>
          </VStack>
          <Switch label="Enabled" value={enabled} onChange={(value) => setEnabled(value)} />
        </HStack>
        <TextInput
          label="Description"
          value={description}
          onChange={(value) => setDescription(value)}
          isOptional
          placeholder="What this skill teaches the reviewer"
        />
        <TextArea
          label="Content"
          value={content}
          onChange={(value) => setContent(value)}
          rows={18}
          description="Markdown works well: checklists, conventions, severity rules."
        />
        <HStack gap={2}>
          <Button
            label={isSaving ? "Saving…" : "Save skill"}
            variant="primary"
            onClick={() => void save()}
            isDisabled={isSaving || isDeleting}
          />
          <Button
            label={isDeleting ? "Deleting…" : "Delete"}
            variant="destructive"
            onClick={() => void remove()}
            isDisabled={isSaving || isDeleting}
          />
        </HStack>
      </VStack>
    </Section>
  );
}

function NewSkillEditor({
  existingNames,
  onCreated,
}: {
  existingNames: string[];
  onCreated: (skill: WorkerSkillRecord) => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const trimmedName = name.trim();
  const nameError = !trimmedName
    ? null
    : !SKILL_NAME_PATTERN.test(trimmedName)
      ? "Use a plain filename: letters, digits, dot, dash, underscore."
      : existingNames.includes(trimmedName)
        ? "A skill with this name already exists."
        : null;

  async function create(): Promise<void> {
    setIsSaving(true);
    try {
      const created = await client.saveWorkerSkill({
        name: trimmedName,
        description: description.trim() || undefined,
        content,
        enabled: true,
      });
      notify({ body: `Skill ${created.name} created.` });
      onCreated(created);
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
          <Heading level={2}>New skill</Heading>
          <Text type="supporting" color="secondary">
            A named instruction file the reviewer reads before every run.
          </Text>
        </VStack>
        <TextInput
          label="File name"
          value={name}
          onChange={(value) => setName(value)}
          placeholder="review-standards.md"
          status={nameError ? { type: "error", message: nameError } : undefined}
        />
        <TextInput
          label="Description"
          value={description}
          onChange={(value) => setDescription(value)}
          isOptional
          placeholder="What this skill teaches the reviewer"
        />
        <TextArea
          label="Content"
          value={content}
          onChange={(value) => setContent(value)}
          rows={14}
          placeholder={"## Review standards\n\n- Every new endpoint needs an authorization check…"}
        />
        <HStack gap={2}>
          <Button
            label={isSaving ? "Creating…" : "Create skill"}
            variant="primary"
            onClick={() => void create()}
            isDisabled={isSaving || !trimmedName || Boolean(nameError) || !content.trim()}
          />
        </HStack>
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
