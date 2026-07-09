"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Section } from "@astryxdesign/core/Section";
import { Selector, SelectorOption } from "@astryxdesign/core/Selector";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { DocumentTextIcon, FolderIcon } from "@heroicons/react/24/outline";
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

type BundleFile = { path: string; content: string };

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Mirrors the API's bundle rules: markdown-only, bundle-relative paths, and a
// SKILL.md entry file in every bundle.
const SKILL_ENTRY_FILE = "SKILL.md";
const SKILL_FILE_PATH_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._ -]*(\/[A-Za-z0-9][A-Za-z0-9._ -]*)*\.md$/i;

const STARTER_ENTRY_CONTENT = `# New skill

Describe what this skill teaches the reviewer and when to apply it.

## Guidance

- Add checklists, conventions, and severity rules here.
- Reference sibling markdown files in this bundle for deeper material.
`;

function sortBundleFiles(files: BundleFile[]): BundleFile[] {
  return [...files].sort((left, right) => {
    if (left.path === SKILL_ENTRY_FILE) return -1;
    if (right.path === SKILL_ENTRY_FILE) return 1;
    return left.path.localeCompare(right.path);
  });
}

async function bundleFilesFromUploads(uploads: File[]): Promise<BundleFile[]> {
  const files = await Promise.all(
    uploads.map(async (file) => ({ path: file.name, content: await file.text() })),
  );
  // A case-variant entry file (skill.md) becomes the canonical SKILL.md.
  return files.map((file) =>
    file.path.toLowerCase() === SKILL_ENTRY_FILE.toLowerCase()
      ? { ...file, path: SKILL_ENTRY_FILE }
      : file,
  );
}

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
                    endContent={
                      skill.enabled ? (
                        <Token
                          label={`${skill.files.length} file${skill.files.length === 1 ? "" : "s"}`}
                          size="sm"
                        />
                      ) : (
                        <Token label="off" size="sm" />
                      )
                    }
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
          // The bundle editor needs the horizontal room; worker facts return
          // on the prompt view.
          selection.kind === "skill" && selectedSkill ? undefined : (
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
          )
        }
        content={
          selection.kind === "skill" && selectedSkill ? (
            <LayoutContent role="main" padding={0}>
              <SkillBundleEditor
                key={selectedSkill.id}
                skill={selectedSkill}
                onSaved={upsertLocalSkill}
                onDeleted={(name) => {
                  setSkills((current) => current.filter((skill) => skill.name !== name));
                  setSelection({ kind: "prompt" });
                }}
              />
            </LayoutContent>
          ) : (
            <LayoutContent role="main" isScrollable padding={5}>
              {selection.kind === "prompt" ? (
                <BasePromptEditor
                  key={config?.updatedAt ?? "unset"}
                  config={config}
                  defaults={defaults}
                  onSaved={setConfig}
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
          )
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

const bundleEditorStyles: Record<string, CSSProperties> = {
  explorer: { overflowY: "auto", height: "100%" },
  editorColumn: { height: "100%", minWidth: 0 },
  editorScroll: { overflowY: "auto", minHeight: 0 },
};

// IDE-shaped bundle editor: file explorer + bundle details on the left,
// tabbed markdown editor on the right. No terminal — skills are documents,
// not processes.
function SkillBundleEditor({
  skill,
  onSaved,
  onDeleted,
}: {
  skill: WorkerSkillRecord;
  onSaved: (skill: WorkerSkillRecord) => void;
  onDeleted: (name: string) => void;
}): ReactElement {
  const [description, setDescription] = useState(skill.description ?? "");
  const [enabled, setEnabled] = useState(skill.enabled);
  const [files, setFiles] = useState<BundleFile[]>(
    sortBundleFiles(skill.files.map(({ path, content }) => ({ path, content }))),
  );
  const initialPath = skill.files[0]?.path ?? SKILL_ENTRY_FILE;
  const [openPaths, setOpenPaths] = useState<string[]>([initialPath]);
  const [activePath, setActivePath] = useState(initialPath);
  const [newFilePath, setNewFilePath] = useState("");
  const [uploadValue, setUploadValue] = useState<File[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeFile = files.find((file) => file.path === activePath) ?? null;
  const savedSnapshot = JSON.stringify(
    sortBundleFiles(skill.files.map(({ path, content }) => ({ path, content }))),
  );
  const isDirty =
    description.trim() !== (skill.description ?? "").trim() ||
    enabled !== skill.enabled ||
    JSON.stringify(sortBundleFiles(files)) !== savedSnapshot;

  const trimmedNewPath = newFilePath.trim();
  const newPathError = !trimmedNewPath
    ? null
    : !SKILL_FILE_PATH_PATTERN.test(trimmedNewPath) || trimmedNewPath.split("/").includes("..")
      ? "Use a bundle-relative markdown path like checklists/security.md."
      : files.some((file) => file.path === trimmedNewPath)
        ? "That file already exists in this bundle."
        : null;

  function openFile(path: string): void {
    setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
    setActivePath(path);
  }

  function updateActiveFile(content: string): void {
    setFiles((current) =>
      current.map((file) => (file.path === activePath ? { ...file, content } : file)),
    );
  }

  function addFile(): void {
    if (!trimmedNewPath || newPathError) {
      return;
    }
    setFiles((current) => sortBundleFiles([...current, { path: trimmedNewPath, content: "" }]));
    setNewFilePath("");
    openFile(trimmedNewPath);
  }

  function removeFile(path: string): void {
    if (path === SKILL_ENTRY_FILE) {
      return;
    }
    setFiles((current) => current.filter((file) => file.path !== path));
    setOpenPaths((current) => {
      const next = current.filter((open) => open !== path);
      if (activePath === path) {
        setActivePath(next[next.length - 1] ?? SKILL_ENTRY_FILE);
      }
      return next.length > 0 ? next : [SKILL_ENTRY_FILE];
    });
  }

  async function mergeUploads(uploads: File[] | null): Promise<void> {
    setUploadValue(uploads);
    const list = Array.isArray(uploads) ? uploads : uploads ? [uploads] : [];
    if (list.length === 0) {
      return;
    }
    try {
      const incoming = await bundleFilesFromUploads(list);
      setFiles((current) => {
        const byPath = new Map(current.map((file) => [file.path, file] as const));
        for (const file of incoming) {
          byPath.set(file.path, file);
        }
        return sortBundleFiles([...byPath.values()]);
      });
      const first = incoming[0];
      if (first) {
        openFile(first.path);
      }
      notify({
        body: `Added ${incoming.length} file${incoming.length === 1 ? "" : "s"} to the bundle. Save to persist.`,
      });
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setUploadValue(null);
    }
  }

  async function save(): Promise<void> {
    setIsSaving(true);
    try {
      const saved = await client.saveWorkerSkill({
        name: skill.name,
        description: description.trim() || undefined,
        enabled,
        files: sortBundleFiles(files),
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

  const openTabs = openPaths.filter((path) => files.some((file) => file.path === path));

  return (
    <Layout
      height="fill"
      start={
        <LayoutPanel padding={4} width={300} hasDivider>
          <VStack gap={5} style={bundleEditorStyles.explorer}>
            <VStack gap={2}>
              <HStack gap={2} hAlign="between" vAlign="center">
                <Heading level={3}>{skill.name}</Heading>
                <Token label={`${files.length} file${files.length === 1 ? "" : "s"}`} size="sm" />
              </HStack>
              <Text type="supporting" color="secondary">
                Uploaded into the sandbox as skills/{skill.name}/ before each run. SKILL.md is the
                entry file.
              </Text>
            </VStack>
            <VStack gap={2}>
              <TreeList
                header="Files"
                items={buildBundleTree(files, activePath, openFile)}
                density="compact"
              />
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <TextInput
                    label="New file path"
                    isLabelHidden
                    value={newFilePath}
                    onChange={(value) => setNewFilePath(value)}
                    placeholder="checklists/security.md"
                    size="sm"
                    status={newPathError ? { type: "error", message: newPathError } : undefined}
                  />
                </StackItem>
                <Button
                  label="Add file"
                  variant="secondary"
                  size="sm"
                  onClick={addFile}
                  isDisabled={!trimmedNewPath || Boolean(newPathError)}
                />
              </HStack>
              <FileInput
                label="Upload markdown files"
                isLabelHidden
                mode="dropzone"
                isMultiple
                accept=".md,.markdown"
                value={uploadValue}
                onChange={(value) => void mergeUploads(value as File[] | null)}
                placeholder="Drop a skill folder's .md files"
                description="Files with matching names replace bundle files."
              />
            </VStack>
            <VStack gap={3}>
              <Heading level={4}>Bundle</Heading>
              <TextInput
                label="Description"
                value={description}
                onChange={(value) => setDescription(value)}
                isOptional
                placeholder="What this skill teaches the reviewer"
                size="sm"
              />
              <Switch label="Enabled" value={enabled} onChange={(value) => setEnabled(value)} />
              <VStack gap={2}>
                <Button
                  label={isSaving ? "Saving…" : isDirty ? "Save bundle" : "Saved"}
                  variant="primary"
                  onClick={() => void save()}
                  isDisabled={isSaving || isDeleting || !isDirty}
                />
                <Button
                  label={isDeleting ? "Deleting…" : "Delete skill"}
                  variant="destructive"
                  onClick={() => void remove()}
                  isDisabled={isSaving || isDeleting}
                />
              </VStack>
            </VStack>
          </VStack>
        </LayoutPanel>
      }
      content={
        <LayoutContent padding={0}>
          <VStack gap={0} height="100%" style={bundleEditorStyles.editorColumn}>
            <TabList
              value={activePath}
              onChange={(value) => setActivePath(value)}
              size="sm"
              hasDivider
            >
              {openTabs.map((path) => (
                <Tab key={path} label={path.split("/").pop() ?? path} value={path} />
              ))}
            </TabList>
            <StackItem size="fill" style={bundleEditorStyles.editorScroll}>
              {activeFile ? (
                <VStack gap={3} padding={4}>
                  <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
                    <Text type="supporting" color="secondary" maxLines={1}>
                      skills/{skill.name}/{activeFile.path}
                    </Text>
                    {activeFile.path === SKILL_ENTRY_FILE ? (
                      <Token label="entry file" size="sm" />
                    ) : (
                      <Button
                        label="Remove file"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeFile(activeFile.path)}
                        isDisabled={isSaving || isDeleting}
                      />
                    )}
                  </HStack>
                  <TextArea
                    label={activeFile.path}
                    isLabelHidden
                    value={activeFile.content}
                    onChange={(value) => updateActiveFile(value)}
                    rows={26}
                    placeholder="Markdown works well: checklists, conventions, severity rules."
                  />
                </VStack>
              ) : (
                <VStack padding={4}>
                  <EmptyState
                    title="No file open"
                    description="Pick a file from the bundle tree to edit it."
                    headingLevel={3}
                  />
                </VStack>
              )}
            </StackItem>
          </VStack>
        </LayoutContent>
      }
    />
  );
}

// Turn flat bundle paths ("checklists/security.md") into TreeList folders.
function buildBundleTree(
  files: BundleFile[],
  activePath: string,
  onOpen: (path: string) => void,
): TreeListItemData[] {
  type FolderNode = {
    folders: Map<string, FolderNode>;
    files: { name: string; path: string }[];
  };
  const root: FolderNode = { folders: new Map(), files: [] };

  for (const file of sortBundleFiles(files)) {
    const segments = file.path.split("/");
    const fileName = segments[segments.length - 1] ?? file.path;
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      let child = node.folders.get(segment);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(segment, child);
      }
      node = child;
    }
    node.files.push({ name: fileName, path: file.path });
  }

  function toItems(node: FolderNode, prefix: string): TreeListItemData[] {
    const folderItems = [...node.folders.entries()].map(
      ([name, child]): TreeListItemData => ({
        id: `${prefix}${name}/`,
        label: <Text maxLines={1}>{name}</Text>,
        startContent: <Icon icon={FolderIcon} size="xsm" />,
        isExpanded: true,
        children: toItems(child, `${prefix}${name}/`),
      }),
    );
    const fileItems = node.files.map(
      (file): TreeListItemData => ({
        id: file.path,
        label: <Text maxLines={1}>{file.name}</Text>,
        startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
        isSelected: file.path === activePath,
        endContent: file.path === SKILL_ENTRY_FILE ? <Token label="entry" size="sm" /> : undefined,
        onClick: () => onOpen(file.path),
      }),
    );
    return [...fileItems, ...folderItems];
  }

  return toItems(root, "");
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
  const [uploadValue, setUploadValue] = useState<File[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const trimmedName = name.trim();
  const nameError = !trimmedName
    ? null
    : !SKILL_NAME_PATTERN.test(trimmedName)
      ? "Use a plain directory name: letters, digits, dot, dash, underscore."
      : existingNames.includes(trimmedName)
        ? "A skill with this name already exists."
        : null;
  const uploads = Array.isArray(uploadValue) ? uploadValue : uploadValue ? [uploadValue] : [];

  async function create(): Promise<void> {
    setIsSaving(true);
    try {
      let files: BundleFile[];
      if (uploads.length > 0) {
        files = await bundleFilesFromUploads(uploads);
        if (!files.some((file) => file.path === SKILL_ENTRY_FILE)) {
          // Uploaded folders without an entry get a starter SKILL.md that
          // points the reviewer at the uploaded material.
          files = [
            {
              path: SKILL_ENTRY_FILE,
              content: `# ${trimmedName}\n\n${
                description.trim() || "Describe when the reviewer should apply this skill."
              }\n\n## Files\n\n${files.map((file) => `- ${file.path}`).join("\n")}\n`,
            },
            ...files,
          ];
        }
      } else {
        files = [{ path: SKILL_ENTRY_FILE, content: STARTER_ENTRY_CONTENT }];
      }

      const created = await client.saveWorkerSkill({
        name: trimmedName,
        description: description.trim() || undefined,
        enabled: true,
        files: sortBundleFiles(files),
      });
      notify({
        body: `Skill ${created.name} created with ${created.files.length} file${created.files.length === 1 ? "" : "s"}.`,
      });
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
            A skill is a bundle of markdown files with a SKILL.md entry, uploaded into the sandbox
            before every run. Start from an uploaded folder or a blank SKILL.md.
          </Text>
        </VStack>
        <TextInput
          label="Skill name"
          value={name}
          onChange={(value) => setName(value)}
          placeholder="review-standards"
          description="Becomes the bundle directory: skills/<name>/."
          status={nameError ? { type: "error", message: nameError } : undefined}
        />
        <TextInput
          label="Description"
          value={description}
          onChange={(value) => setDescription(value)}
          isOptional
          placeholder="What this skill teaches the reviewer"
        />
        <FileInput
          label="Upload a skill folder's markdown files"
          mode="dropzone"
          isMultiple
          accept=".md,.markdown"
          value={uploadValue}
          onChange={(value) => setUploadValue(value as File[] | null)}
          isOptional
          placeholder="Drop .md files here, SKILL.md included"
          description="Skip this to start from a blank SKILL.md you can edit right after."
        />
        {uploads.length > 0 ? (
          <HStack gap={1} wrap="wrap">
            {uploads.map((file) => (
              <Token key={file.name} label={file.name} size="sm" />
            ))}
          </HStack>
        ) : null}
        <HStack gap={2}>
          <Button
            label={isSaving ? "Creating…" : "Create skill"}
            variant="primary"
            onClick={() => void create()}
            isDisabled={isSaving || !trimmedName || Boolean(nameError)}
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
