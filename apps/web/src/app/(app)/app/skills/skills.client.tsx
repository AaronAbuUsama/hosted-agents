"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { DocumentTextIcon, FolderIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import { notify } from "@/lib/toast-bridge";
import { client } from "@/utils/orpc";

type WorkerConfiguration = Awaited<ReturnType<typeof client.workerConfiguration>>;
type WorkerSkillRecord = WorkerConfiguration["skills"][number];

type BundleFile = { path: string; content: string };
type Bundle = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  files: BundleFile[];
};

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SKILL_ENTRY_FILE = "SKILL.md";
const SKILL_FILE_PATH_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._ -]*(\/[A-Za-z0-9][A-Za-z0-9._ -]*)*\.md$/i;

const STARTER_ENTRY_CONTENT = `# New skill

Describe what this skill teaches the reviewer and when to apply it.

## Guidance

- Add checklists, conventions, and severity rules here.
- Reference sibling markdown files in this bundle for deeper material.
`;

const panelScroll: CSSProperties = { overflowY: "auto", height: "100%" };
const editorColumn: CSSProperties = { height: "100%", minWidth: 0 };
const editorScroll: CSSProperties = { overflowY: "auto", minHeight: 0 };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function sortBundleFiles(files: BundleFile[]): BundleFile[] {
  return [...files].sort((left, right) => {
    if (left.path === SKILL_ENTRY_FILE) return -1;
    if (right.path === SKILL_ENTRY_FILE) return 1;
    return left.path.localeCompare(right.path);
  });
}

function toBundle(skill: WorkerSkillRecord): Bundle {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? "",
    enabled: skill.enabled,
    files: sortBundleFiles(skill.files.map(({ path, content }) => ({ path, content }))),
  };
}

async function bundleFilesFromUploads(uploads: File[]): Promise<BundleFile[]> {
  const files = await Promise.all(
    uploads.map(async (file) => ({ path: file.name, content: await file.text() })),
  );
  return files.map((file) =>
    file.path.toLowerCase() === SKILL_ENTRY_FILE.toLowerCase()
      ? { ...file, path: SKILL_ENTRY_FILE }
      : file,
  );
}

// Every skill bundle is a folder in the explorer; its files nest beneath it,
// so one tree covers the whole library instead of a separate list-plus-files.
// A search keeps bundles whose name matches, or whose files match (those files
// are filtered too).
function buildExplorerTree(
  bundles: Bundle[],
  active: { skill: string; path: string } | null,
  search: string,
  onOpen: (skill: string, path: string) => void,
): TreeListItemData[] {
  const query = search.trim().toLowerCase();
  const items: TreeListItemData[] = [];

  for (const bundle of bundles) {
    const bundleMatches = bundle.name.toLowerCase().includes(query);
    const files = query
      ? bundle.files.filter((file) => bundleMatches || file.path.toLowerCase().includes(query))
      : bundle.files;
    if (query && !bundleMatches && files.length === 0) {
      continue;
    }

    items.push({
      id: `skill:${bundle.name}`,
      label: <Text maxLines={1}>{bundle.name}</Text>,
      startContent: <Icon icon={FolderIcon} size="xsm" />,
      endContent: bundle.enabled ? undefined : <Token label="off" size="sm" />,
      isExpanded: query.length > 0 || active?.skill === bundle.name,
      children: files.map((file) => ({
        id: `file:${bundle.name}:${file.path}`,
        label: <Text maxLines={1}>{file.path}</Text>,
        startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
        isSelected: active?.skill === bundle.name && active.path === file.path,
        endContent: file.path === SKILL_ENTRY_FILE ? <Token label="entry" size="sm" /> : undefined,
        onClick: () => onOpen(bundle.name, file.path),
      })),
    });
  }

  return items;
}

export default function SkillsClient({
  initialSkills,
}: {
  initialSkills: WorkerSkillRecord[];
}): ReactElement {
  const [bundles, setBundles] = useState<Bundle[]>(initialSkills.map(toBundle));
  const [saved, setSaved] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialSkills.map((skill) => [skill.name, snapshot(toBundle(skill))])),
  );
  const firstSkill = initialSkills[0];
  const [active, setActive] = useState<{ skill: string; path: string } | null>(
    firstSkill
      ? { skill: firstSkill.name, path: firstSkill.files[0]?.path ?? SKILL_ENTRY_FILE }
      : null,
  );
  const [openPaths, setOpenPaths] = useState<Record<string, string[]>>(
    firstSkill ? { [firstSkill.name]: [firstSkill.files[0]?.path ?? SKILL_ENTRY_FILE] } : {},
  );
  const [newFilePath, setNewFilePath] = useState("");
  const [uploadValue, setUploadValue] = useState<File[] | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"source" | "edit">("source");
  const [explorerSearch, setExplorerSearch] = useState("");

  const activeBundle = active ? (bundles.find((b) => b.name === active.skill) ?? null) : null;
  const activeFile = activeBundle?.files.find((file) => file.path === active?.path) ?? null;
  const activeDirty = activeBundle ? snapshot(activeBundle) !== saved[activeBundle.name] : false;
  const activeOpenTabs = activeBundle
    ? (openPaths[activeBundle.name] ?? []).filter((path) =>
        activeBundle.files.some((file) => file.path === path),
      )
    : [];

  const trimmedNewPath = newFilePath.trim();
  const newPathError =
    !trimmedNewPath || !activeBundle
      ? null
      : !SKILL_FILE_PATH_PATTERN.test(trimmedNewPath) || trimmedNewPath.split("/").includes("..")
        ? "Use a bundle-relative markdown path like checklists/security.md."
        : activeBundle.files.some((file) => file.path === trimmedNewPath)
          ? "That file already exists in this bundle."
          : null;

  function openFile(skill: string, path: string): void {
    setOpenPaths((current) => {
      const forSkill = current[skill] ?? [];
      return forSkill.includes(path) ? current : { ...current, [skill]: [...forSkill, path] };
    });
    setActive({ skill, path });
  }

  function patchActiveBundle(update: (bundle: Bundle) => Bundle): void {
    if (!activeBundle) {
      return;
    }
    setBundles((current) =>
      current.map((bundle) => (bundle.name === activeBundle.name ? update(bundle) : bundle)),
    );
  }

  function updateActiveFile(content: string): void {
    patchActiveBundle((bundle) => ({
      ...bundle,
      files: bundle.files.map((file) => (file.path === active?.path ? { ...file, content } : file)),
    }));
  }

  function addFile(): void {
    if (!activeBundle || !trimmedNewPath || newPathError) {
      return;
    }
    patchActiveBundle((bundle) => ({
      ...bundle,
      files: sortBundleFiles([...bundle.files, { path: trimmedNewPath, content: "" }]),
    }));
    openFile(activeBundle.name, trimmedNewPath);
    setNewFilePath("");
  }

  function removeFile(path: string): void {
    if (!activeBundle || path === SKILL_ENTRY_FILE) {
      return;
    }
    patchActiveBundle((bundle) => ({
      ...bundle,
      files: bundle.files.filter((file) => file.path !== path),
    }));
    setOpenPaths((current) => ({
      ...current,
      [activeBundle.name]: (current[activeBundle.name] ?? []).filter((open) => open !== path),
    }));
    if (active?.path === path) {
      setActive({ skill: activeBundle.name, path: SKILL_ENTRY_FILE });
    }
  }

  async function uploadToActive(uploads: File[] | null): Promise<void> {
    setUploadValue(uploads);
    const list = Array.isArray(uploads) ? uploads : uploads ? [uploads] : [];
    if (!activeBundle || list.length === 0) {
      return;
    }
    try {
      const incoming = await bundleFilesFromUploads(list);
      patchActiveBundle((bundle) => {
        const byPath = new Map(bundle.files.map((file) => [file.path, file] as const));
        for (const file of incoming) {
          byPath.set(file.path, file);
        }
        return { ...bundle, files: sortBundleFiles([...byPath.values()]) };
      });
      const first = incoming[0];
      if (first) {
        openFile(activeBundle.name, first.path);
      }
      notify({
        body: `Added ${incoming.length} file${incoming.length === 1 ? "" : "s"}. Save to persist.`,
      });
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setUploadValue(null);
    }
  }

  async function saveActive(): Promise<void> {
    if (!activeBundle) {
      return;
    }
    setSavingName(activeBundle.name);
    try {
      const result = await client.saveWorkerSkill({
        name: activeBundle.name,
        description: activeBundle.description.trim() || undefined,
        enabled: activeBundle.enabled,
        files: sortBundleFiles(activeBundle.files),
      });
      const nextBundle = toBundle(result);
      setBundles((current) =>
        current.map((bundle) => (bundle.name === nextBundle.name ? nextBundle : bundle)),
      );
      setSaved((current) => ({ ...current, [nextBundle.name]: snapshot(nextBundle) }));
      notify({ body: `Skill ${nextBundle.name} saved.` });
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setSavingName(null);
    }
  }

  async function deleteActive(): Promise<void> {
    if (!activeBundle) {
      return;
    }
    const name = activeBundle.name;
    setDeletingName(name);
    try {
      await client.deleteWorkerSkill({ name });
      setBundles((current) => current.filter((bundle) => bundle.name !== name));
      const next = bundles.find((bundle) => bundle.name !== name);
      setActive(next ? { skill: next.name, path: next.files[0]?.path ?? SKILL_ENTRY_FILE } : null);
      notify({ body: `Skill ${name} deleted.` });
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setDeletingName(null);
    }
  }

  function onCreated(created: WorkerSkillRecord): void {
    const bundle = toBundle(created);
    setBundles((current) =>
      current.some((existing) => existing.name === bundle.name)
        ? current.map((existing) => (existing.name === bundle.name ? bundle : existing))
        : [...current, bundle].sort((left, right) => left.name.localeCompare(right.name)),
    );
    setSaved((current) => ({ ...current, [bundle.name]: snapshot(bundle) }));
    openFile(bundle.name, SKILL_ENTRY_FILE);
    setIsNewOpen(false);
  }

  return (
    <>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={3}>
            <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Icon icon={FolderIcon} size="sm" color="secondary" />
                <Text type="supporting" color="secondary">
                  Skills
                </Text>
                {activeBundle ? (
                  <>
                    <Text type="supporting" color="secondary">
                      /
                    </Text>
                    <Heading level={3}>{activeBundle.name}</Heading>
                  </>
                ) : null}
              </HStack>
              <Button
                label={savingName ? "Saving…" : activeDirty ? "Save bundle" : "Saved"}
                variant="primary"
                size="sm"
                onClick={() => void saveActive()}
                isDisabled={!activeBundle || !activeDirty || Boolean(savingName)}
              />
            </HStack>
          </LayoutHeader>
        }
        start={
          <LayoutPanel padding={3} width={248} hasDivider>
            <VStack gap={3} style={panelScroll}>
              <Button
                label="New skill"
                variant="secondary"
                size="sm"
                onClick={() => setIsNewOpen(true)}
              />
              {bundles.length === 0 ? (
                <Text type="supporting" color="secondary">
                  No skills yet. Create one to start a bundle.
                </Text>
              ) : (
                <>
                  <TextInput
                    label="Search files"
                    isLabelHidden
                    size="sm"
                    width="100%"
                    startIcon={MagnifyingGlassIcon}
                    hasClear
                    placeholder="Search skills and files…"
                    value={explorerSearch}
                    onChange={setExplorerSearch}
                  />
                  <TreeList
                    header="Skill bundles"
                    items={buildExplorerTree(bundles, active, explorerSearch, openFile)}
                    density="compact"
                  />
                </>
              )}
            </VStack>
          </LayoutPanel>
        }
        content={
          <LayoutContent padding={0}>
            {activeBundle && activeFile ? (
              <VStack gap={0} height="100%" style={editorColumn}>
                <TabList
                  value={active?.path ?? ""}
                  onChange={(value) =>
                    setActive(activeBundle ? { skill: activeBundle.name, path: value } : null)
                  }
                  size="sm"
                  hasDivider
                >
                  {activeOpenTabs.map((path) => (
                    <Tab key={path} label={path.split("/").pop() ?? path} value={path} />
                  ))}
                </TabList>
                <StackItem size="fill" style={editorScroll}>
                  <VStack gap={3} padding={4}>
                    <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
                      <Text type="supporting" color="secondary" maxLines={1}>
                        skills/{activeBundle.name}/{activeFile.path}
                      </Text>
                      <HStack gap={2} vAlign="center">
                        <SegmentedControl
                          label="Editor mode"
                          value={editorMode}
                          onChange={(value) => setEditorMode(value === "edit" ? "edit" : "source")}
                          size="sm"
                        >
                          <SegmentedControlItem label="Source" value="source" />
                          <SegmentedControlItem label="Edit" value="edit" />
                        </SegmentedControl>
                        {activeFile.path === SKILL_ENTRY_FILE ? (
                          <Token label="entry file" size="sm" />
                        ) : (
                          <Button
                            label="Remove file"
                            variant="destructive"
                            size="sm"
                            onClick={() => removeFile(activeFile.path)}
                          />
                        )}
                      </HStack>
                    </HStack>
                    {editorMode === "edit" ? (
                      <TextArea
                        label={activeFile.path}
                        isLabelHidden
                        value={activeFile.content}
                        onChange={(value) => updateActiveFile(value)}
                        rows={24}
                        hasSpellCheck={false}
                        placeholder="Markdown works well: checklists, conventions, severity rules."
                      />
                    ) : (
                      <CodeBlock
                        code={
                          activeFile.content ||
                          "# Empty file\n\nSwitch to Edit to write this skill.\n"
                        }
                        language="markdown"
                        title={activeFile.path}
                        hasLineNumbers
                        isWrapped
                        hasCopyButton
                        width="100%"
                      />
                    )}
                  </VStack>
                </StackItem>
              </VStack>
            ) : (
              <VStack padding={6} height="100%">
                <EmptyState
                  title={bundles.length === 0 ? "No skills yet" : "Select a file"}
                  description={
                    bundles.length === 0
                      ? "Create a skill bundle to author its SKILL.md and supporting files."
                      : "Pick a file from a skill bundle in the explorer to edit it."
                  }
                  headingLevel={2}
                  actions={
                    bundles.length === 0 ? (
                      <Button
                        label="New skill"
                        variant="primary"
                        onClick={() => setIsNewOpen(true)}
                      />
                    ) : undefined
                  }
                />
              </VStack>
            )}
          </LayoutContent>
        }
        end={
          activeBundle ? (
            <LayoutPanel padding={4} width={288} hasDivider>
              <VStack gap={4} style={panelScroll}>
                <Heading level={4}>Bundle</Heading>
                <TextInput
                  label="Name"
                  value={activeBundle.name}
                  onChange={() => undefined}
                  isDisabled
                  description="The bundle directory: skills/<name>/. Rename by creating a new skill."
                />
                <TextInput
                  label="Description"
                  value={activeBundle.description}
                  onChange={(value) =>
                    patchActiveBundle((bundle) => ({ ...bundle, description: value }))
                  }
                  isOptional
                  placeholder="What this skill teaches the reviewer"
                />
                <Switch
                  label="Enabled"
                  value={activeBundle.enabled}
                  onChange={(value) =>
                    patchActiveBundle((bundle) => ({ ...bundle, enabled: value }))
                  }
                />
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">
                    Attached to
                  </Text>
                  <HStack gap={1} wrap="wrap">
                    <Token label="Reviewer" size="sm" />
                  </HStack>
                </VStack>
                <VStack gap={2}>
                  <Text type="supporting" color="secondary">
                    Add files
                  </Text>
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
                      label="Add"
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
                    onChange={(value) => void uploadToActive(value as File[] | null)}
                    placeholder="Drop .md files into this bundle"
                    description="Matching names replace existing files."
                  />
                </VStack>
                <VStack gap={2}>
                  <Button
                    label={deletingName === activeBundle.name ? "Deleting…" : "Delete skill"}
                    variant="destructive"
                    onClick={() => void deleteActive()}
                    isDisabled={Boolean(deletingName)}
                  />
                </VStack>
              </VStack>
            </LayoutPanel>
          ) : undefined
        }
      />
      <NewSkillDialog
        isOpen={isNewOpen}
        onOpenChange={setIsNewOpen}
        existingNames={bundles.map((bundle) => bundle.name)}
        onCreated={onCreated}
      />
    </>
  );
}

function snapshot(bundle: Bundle): string {
  return JSON.stringify({
    description: bundle.description.trim(),
    enabled: bundle.enabled,
    files: sortBundleFiles(bundle.files),
  });
}

function NewSkillDialog({
  isOpen,
  onOpenChange,
  existingNames,
  onCreated,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
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
      setName("");
      setDescription("");
      setUploadValue(null);
      onCreated(created);
    } catch (error) {
      notify({ body: errorText(error), type: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={520} purpose="form">
      <DialogHeader
        title="New skill"
        subtitle="A bundle of markdown files with a SKILL.md entry."
        onOpenChange={onOpenChange}
      />
      <VStack gap={4}>
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
        <HStack gap={2} hAlign="end">
          <Button
            label="Cancel"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            isDisabled={isSaving}
          />
          <Button
            label={isSaving ? "Creating…" : "Create skill"}
            variant="primary"
            onClick={() => void create()}
            isDisabled={isSaving || !trimmedName || Boolean(nameError)}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
