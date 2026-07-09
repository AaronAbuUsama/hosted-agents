"use client";

import { useMemo, useState, type ReactElement, type Ref } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
  type SideNavImperativeCollapseHandle,
} from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  CodeBracketIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  FolderIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useLiveQuery } from "@tanstack/react-db";
import { usePathname } from "next/navigation";

import { agentRunsCollection } from "@/lib/collections/agent-runs";
import { githubInstallationsCollection } from "@/lib/collections/github-installations";
import type { RunViewModelRow, RunViewModelStatus } from "@/lib/run-view-model";

const RUNS_PATH = "/app/runs";
const REVIEWER_PATH = "/app/reviewer";
const SKILLS_PATH = "/app/skills";
const SETTINGS_PATH = "/app/settings";
const PROJECTS_PATH = "/app/projects";

type SettingsNavItem = { href: string; label: string; icon: IconType };

// Settings is a route group; in a settings route the rail becomes these
// sections. Keep in sync with the pages under app/(app)/app/settings/.
const SETTINGS_SECTIONS: SettingsNavItem[] = [
  { href: "/app/settings/organization", label: "Organization", icon: BuildingOffice2Icon },
  { href: "/app/settings/github", label: "GitHub & repositories", icon: CodeBracketIcon },
  { href: "/app/settings/provider", label: "Provider", icon: KeyIcon },
  { href: "/app/settings/reviewer", label: "Reviewer", icon: ShieldCheckIcon },
];

type RepoNavItem = {
  id: string;
  label: string;
  runs: RunViewModelRow[];
};

// Mirrors the status-dot vocabulary used by the Runs table so a run reads the
// same in the rail as it does in the table.
const runStatusDotVariants: Record<RunViewModelStatus, StatusDotVariant> = {
  Queued: "accent",
  Running: "accent",
  Completed: "success",
  Failed: "error",
  Unknown: "warning",
};

const fullWidthButtonStyle = { width: "100%" } as const;

function isPathSelected(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// A repository's dot reflects its most relevant run: an in-flight run wins
// (accent), otherwise the latest run's outcome; a repo with no runs is neutral.
function repoStatus(runs: RunViewModelRow[]): { variant: StatusDotVariant; label: string } {
  if (runs.length === 0) {
    return { variant: "neutral", label: "No runs yet" };
  }

  if (runs.some((run) => run.status === "Running" || run.status === "Queued")) {
    return { variant: "accent", label: "Active run" };
  }

  const [latest] = runs;
  return { variant: runStatusDotVariants[latest.status], label: latest.status };
}

// Lists the repositories a worker is configured to watch (the settings toggle),
// each carrying its runs so the rail can show a status dot. Ordered by
// most-recent run activity, then alphabetically.
function buildRepoNav(
  installations: { repositories: { id: string; fullName: string; selected: boolean }[] }[],
  runs: RunViewModelRow[],
): RepoNavItem[] {
  const runsByRepo = new Map<string, RunViewModelRow[]>();
  const firstSeenIndex = new Map<string, number>();

  runs.forEach((run, index) => {
    const existing = runsByRepo.get(run.repo);
    if (existing) {
      existing.push(run);
    } else {
      runsByRepo.set(run.repo, [run]);
      firstSeenIndex.set(run.repo, index);
    }
  });

  const items: RepoNavItem[] = [];
  const seen = new Set<string>();

  for (const installation of installations) {
    for (const repo of installation.repositories) {
      if (!repo.selected || seen.has(repo.id)) {
        continue;
      }
      seen.add(repo.id);
      items.push({ id: repo.id, label: repo.fullName, runs: runsByRepo.get(repo.fullName) ?? [] });
    }
  }

  return items.sort((left, right) => {
    const leftRank = firstSeenIndex.get(left.label) ?? Number.POSITIVE_INFINITY;
    const rightRank = firstSeenIndex.get(right.label) ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.label.localeCompare(right.label);
  });
}

// When searching, keep repositories whose name matches the query.
function filterRepoNav(items: RepoNavItem[], query: string): RepoNavItem[] {
  if (!query) {
    return items;
  }

  return items.filter((item) => item.label.toLowerCase().includes(query));
}

// The live-data rail is mounted client-only by AppFrame so its TanStack DB
// live queries never run during the SSR pass (they use useSyncExternalStore
// without a server snapshot). See AppFrame for the mounted gate.
export default function AppSideNav({
  handleRef,
  isCollapsed,
  onCollapsedChange,
}: {
  handleRef: Ref<SideNavImperativeCollapseHandle>;
  isCollapsed: boolean;
  onCollapsedChange: (isCollapsed: boolean) => void;
}): ReactElement {
  const pathname = usePathname();
  const [search, setSearch] = useState("");

  const { data: runs } = useLiveQuery(agentRunsCollection);
  const {
    data: installations,
    isLoading: isReposLoading,
    isError: isReposError,
  } = useLiveQuery(githubInstallationsCollection);

  const activeRunsCount = useMemo(
    () => runs.filter((run) => run.status === "Running" || run.status === "Queued").length,
    [runs],
  );
  const repoNav = useMemo(() => buildRepoNav(installations, runs), [installations, runs]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const visibleRepos = useMemo(() => filterRepoNav(repoNav, query), [repoNav, query]);
  const isSettingsRoute = isPathSelected(pathname, SETTINGS_PATH);

  return (
    <SideNav
      handleRef={handleRef}
      collapsible={{
        isCollapsed,
        onCollapsedChange,
        hasButton: isCollapsed,
      }}
      resizable={{ defaultWidth: 300, minWidth: 240, maxWidth: 420 }}
      topContent={
        isSettingsRoute ? null : (
          <VStack gap={2}>
            <Button
              label="New review"
              variant="primary"
              size="sm"
              href={REVIEWER_PATH}
              icon={<Icon icon={PlusIcon} size="sm" />}
              style={fullWidthButtonStyle}
            />
            <TextInput
              label="Search repositories"
              isLabelHidden
              size="sm"
              width="100%"
              startIcon={MagnifyingGlassIcon}
              hasClear
              placeholder="Search repositories…"
              value={search}
              onChange={setSearch}
            />
          </VStack>
        )
      }
      footer={
        <SideNavSection title="Account" isHeaderHidden>
          {isSettingsRoute ? null : (
            <SideNavItem
              label="Settings"
              icon={Cog6ToothIcon}
              href={SETTINGS_PATH}
              isSelected={isPathSelected(pathname, SETTINGS_PATH)}
            />
          )}
        </SideNavSection>
      }
    >
      {isSettingsRoute ? (
        <SideNavSection title="Settings">
          <SideNavItem label="Workspace" icon={ArrowLeftIcon} href={RUNS_PATH} />
          {SETTINGS_SECTIONS.map((section) => (
            <SideNavItem
              key={section.href}
              label={section.label}
              icon={section.icon}
              href={section.href}
              isSelected={isPathSelected(pathname, section.href)}
            />
          ))}
          <SideNavItem label="Billing" icon={CreditCardIcon} isDisabled />
        </SideNavSection>
      ) : (
        <>
          <SideNavSection title="Workspace" isHeaderHidden>
            <SideNavItem
              label="Runs"
              icon={PlayCircleIcon}
              href={RUNS_PATH}
              isSelected={pathname === RUNS_PATH}
              endContent={
                <StatusDot
                  variant={activeRunsCount > 0 ? "accent" : "neutral"}
                  label={`${activeRunsCount} active ${activeRunsCount === 1 ? "run" : "runs"}`}
                />
              }
            />
            <SideNavItem
              label="Reviewer"
              icon={ShieldCheckIcon}
              href={REVIEWER_PATH}
              isSelected={isPathSelected(pathname, REVIEWER_PATH)}
            />
            <SideNavItem
              label="Skills"
              icon={SparklesIcon}
              href={SKILLS_PATH}
              isSelected={isPathSelected(pathname, SKILLS_PATH)}
            />
          </SideNavSection>
          <Divider />
          <SideNavSection title="Repositories">
            {isReposError ? (
              <SideNavItem label="Couldn't load repositories" icon={FolderIcon} isDisabled />
            ) : isReposLoading && repoNav.length === 0 ? (
              <SideNavItem label="Loading repositories…" icon={FolderIcon} isDisabled />
            ) : visibleRepos.length === 0 ? (
              <SideNavItem
                label={searching ? "No matches" : "No repositories enabled"}
                icon={FolderIcon}
                isDisabled
              />
            ) : (
              visibleRepos.map((repo) => {
                const status = repoStatus(repo.runs);
                const href = `${PROJECTS_PATH}/${repo.id}`;

                return (
                  <SideNavItem
                    key={repo.id}
                    label={repo.label}
                    icon={FolderIcon}
                    href={href}
                    isSelected={isPathSelected(pathname, href)}
                    endContent={<StatusDot variant={status.variant} label={status.label} />}
                  />
                );
              })
            )}
          </SideNavSection>
        </>
      )}
    </SideNav>
  );
}
