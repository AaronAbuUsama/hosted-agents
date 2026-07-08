"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import {
  SideNav,
  SideNavCollapseButton,
  SideNavItem,
  SideNavSection,
  type SideNavImperativeCollapseHandle,
} from "@astryxdesign/core/SideNav";
import { HStack, Stack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TopNav } from "@astryxdesign/core/TopNav";
import {
  ArrowRightStartOnRectangleIcon,
  BuildingOffice2Icon,
  Cog6ToothIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useLiveQuery } from "@tanstack/react-db";
import { usePathname, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { agentRunsCollection } from "@/lib/collections/agent-runs";
import { githubInstallationsCollection } from "@/lib/collections/github-installations";
import type { RunViewModelRow, RunViewModelStatus } from "@/lib/run-view-model";

type AppFrameProps = {
  children: ReactNode;
  organizationLabel: string;
  userEmail?: string | null;
  userLabel: string;
};

const RUNS_PATH = "/app/runs";
const REVIEWER_PATH = "/app/reviewer";
const SETTINGS_PATH = "/app/settings";

// How many runs to surface under each repository before deferring to the full
// Runs table, and the repo count above which groups start collapsed to keep the
// rail scannable as more repositories (and later, more workers) are added.
const RECENT_RUNS_PER_REPO = 5;
const COLLAPSE_REPOS_ABOVE = 4;

type RepoGroup = {
  key: string;
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

const outletStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  backgroundColor: "var(--color-background-surface)",
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-container)",
};

const contentShellStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  padding: "var(--spacing-2)",
  backgroundColor: "var(--color-background-body)",
};

const fullWidthButtonStyle: CSSProperties = { width: "100%" };

function isPathSelected(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isRunSelected(pathname: string, runId: string): boolean {
  const runHref = `${RUNS_PATH}/${runId}`;
  return pathname === runHref || pathname.startsWith(`${runHref}/`);
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

// Groups runs under the repositories a worker is configured to watch. Enabled
// repositories (the settings toggle) come first and are always shown, even with
// no runs yet; any repository that only appears in run history is appended so no
// run is orphaned. Ordered by most-recent activity.
function buildRepoGroups(
  installations: { repositories: { id: string; fullName: string; selected: boolean }[] }[],
  runs: RunViewModelRow[],
): RepoGroup[] {
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

  const groups: RepoGroup[] = [];
  const seen = new Set<string>();

  for (const installation of installations) {
    for (const repo of installation.repositories) {
      if (!repo.selected || seen.has(repo.fullName)) {
        continue;
      }
      seen.add(repo.fullName);
      groups.push({ key: repo.id, label: repo.fullName, runs: runsByRepo.get(repo.fullName) ?? [] });
    }
  }

  for (const [label, repoRuns] of runsByRepo) {
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    groups.push({ key: `repo:${label}`, label, runs: repoRuns });
  }

  return groups.sort((left, right) => {
    const leftRank = firstSeenIndex.get(left.label) ?? Number.POSITIVE_INFINITY;
    const rightRank = firstSeenIndex.get(right.label) ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.label.localeCompare(right.label);
  });
}

// When searching, a repo matches by name (keep all its runs) or by any run
// title (keep only matching runs); non-matching repos drop out.
function filterRepoGroups(groups: RepoGroup[], query: string): RepoGroup[] {
  if (!query) {
    return groups;
  }

  const matches: RepoGroup[] = [];
  for (const group of groups) {
    if (group.label.toLowerCase().includes(query)) {
      matches.push(group);
      continue;
    }

    const matchedRuns = group.runs.filter((run) => run.title.toLowerCase().includes(query));
    if (matchedRuns.length > 0) {
      matches.push({ ...group, runs: matchedRuns });
    }
  }

  return matches;
}

export default function AppFrame({
  children,
  organizationLabel,
  userEmail,
  userLabel,
}: AppFrameProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const sideNavHandleRef = useRef<SideNavImperativeCollapseHandle>(null);
  const [isSideNavCollapsed, setIsSideNavCollapsed] = useState(false);
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
  const repoGroups = useMemo(
    () => buildRepoGroups(installations, runs),
    [installations, runs],
  );

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const visibleGroups = useMemo(() => filterRepoGroups(repoGroups, query), [repoGroups, query]);
  const collapseByDefault = repoGroups.length > COLLAPSE_REPOS_ABOVE;

  function handleSignOut(): void {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  }

  return (
    <AppShell
      contentPadding={0}
      topNav={
        <TopNav
          label="Coworker workspace"
          startContent={
            <HStack gap={2} vAlign="center">
              <Icon icon={SparklesIcon} size="sm" />
              <Text weight="semibold">Coworker</Text>
              <Text type="supporting" color="secondary">
                {organizationLabel}
              </Text>
              {!isSideNavCollapsed ? <SideNavCollapseButton handleRef={sideNavHandleRef} /> : null}
            </HStack>
          }
          endContent={
            <DropdownMenu
              button={{
                label: userLabel,
                variant: "secondary",
                size: "sm",
                icon: <Icon icon={UserCircleIcon} size="sm" />,
              }}
              menuWidth={260}
            >
              <DropdownMenuItem
                label={organizationLabel}
                description="Coworker organization"
                icon={BuildingOffice2Icon}
                isDisabled
              />
              {userEmail ? (
                <DropdownMenuItem
                  label={userEmail}
                  description="Signed-in account"
                  icon={UserCircleIcon}
                  isDisabled
                />
              ) : null}
              <Divider />
              <DropdownMenuItem
                label="Workspace settings"
                description="Organization, GitHub App, provider, and rules"
                icon={Cog6ToothIcon}
                onClick={() => router.push(SETTINGS_PATH)}
              />
              <DropdownMenuItem
                label="Sign out"
                icon={ArrowRightStartOnRectangleIcon}
                onClick={handleSignOut}
              />
            </DropdownMenu>
          }
        />
      }
      sideNav={
        <SideNav
          handleRef={sideNavHandleRef}
          collapsible={{
            isCollapsed: isSideNavCollapsed,
            onCollapsedChange: setIsSideNavCollapsed,
            hasButton: isSideNavCollapsed,
          }}
          resizable={{ defaultWidth: 300, minWidth: 240, maxWidth: 420 }}
          topContent={
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
                label="Search runs and repositories"
                isLabelHidden
                size="sm"
                width="100%"
                startIcon={MagnifyingGlassIcon}
                hasClear
                placeholder="Search repos & runs…"
                value={search}
                onChange={setSearch}
              />
            </VStack>
          }
          footer={
            <SideNavSection title="Account" isHeaderHidden>
              <SideNavItem
                label="Settings"
                icon={Cog6ToothIcon}
                href={SETTINGS_PATH}
                isSelected={isPathSelected(pathname, SETTINGS_PATH)}
              />
              <SideNavItem
                label={`${activeRunsCount} active ${activeRunsCount === 1 ? "run" : "runs"}`}
                icon={PlayCircleIcon}
                href={RUNS_PATH}
                endContent={
                  <StatusDot
                    variant={activeRunsCount > 0 ? "accent" : "neutral"}
                    label="Active runs"
                  />
                }
              />
            </SideNavSection>
          }
        >
          <SideNavSection title="Workspace" isHeaderHidden>
            <SideNavItem
              label="Runs"
              icon={PlayCircleIcon}
              href={RUNS_PATH}
              isSelected={pathname === RUNS_PATH}
            />
            <SideNavItem
              label="Reviewer"
              icon={ShieldCheckIcon}
              href={REVIEWER_PATH}
              isSelected={isPathSelected(pathname, REVIEWER_PATH)}
            />
          </SideNavSection>
          <Divider />
          <SideNavSection title="Repositories">
            {isReposError ? (
              <SideNavItem label="Couldn't load repositories" icon={FolderIcon} isDisabled />
            ) : isReposLoading && repoGroups.length === 0 ? (
              <SideNavItem label="Loading repositories…" icon={FolderIcon} isDisabled />
            ) : visibleGroups.length === 0 ? (
              <SideNavItem
                label={searching ? "No matches" : "No repositories enabled"}
                icon={FolderIcon}
                isDisabled
              />
            ) : (
              visibleGroups.map((group) => {
                const status = repoStatus(group.runs);
                const isActive = group.runs.some((run) => isRunSelected(pathname, run.id));
                const expanded = searching || isActive || !collapseByDefault;
                const shownRuns = group.runs.slice(0, RECENT_RUNS_PER_REPO);
                const overflowCount = group.runs.length - shownRuns.length;

                return (
                  <SideNavItem
                    key={`${group.key}:${expanded ? "open" : "closed"}`}
                    label={group.label}
                    icon={FolderIcon}
                    endContent={<StatusDot variant={status.variant} label={status.label} />}
                    collapsible={{ defaultIsCollapsed: !expanded }}
                  >
                    <VStack gap={0.5}>
                      {group.runs.length === 0 ? (
                        <SideNavItem label="No runs yet" isDisabled />
                      ) : (
                        <>
                          {shownRuns.map((run) => (
                            <SideNavItem
                              key={run.id}
                              label={run.title}
                              href={`${RUNS_PATH}/${run.id}`}
                              isSelected={isRunSelected(pathname, run.id)}
                              endContent={
                                <StatusDot
                                  variant={runStatusDotVariants[run.status]}
                                  label={run.status}
                                />
                              }
                            />
                          ))}
                          {overflowCount > 0 ? (
                            <SideNavItem label={`+${overflowCount} more`} href={RUNS_PATH} />
                          ) : null}
                        </>
                      )}
                    </VStack>
                  </SideNavItem>
                );
              })
            )}
          </SideNavSection>
        </SideNav>
      }
    >
      <Layout
        height="fill"
        content={
          <LayoutContent padding={0}>
            <Stack style={contentShellStyle}>
              <Stack data-coworker-app-outlet style={outletStyle}>
                {children}
              </Stack>
            </Stack>
          </LayoutContent>
        }
      />
    </AppShell>
  );
}
