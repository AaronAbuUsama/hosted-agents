"use client";

import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import type { IconType } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { HStack, Stack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TopNav } from "@astryxdesign/core/TopNav";
import {
  ArrowLeftIcon,
  BellIcon,
  BuildingOffice2Icon,
  ChartBarSquareIcon,
  Cog6ToothIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { usePathname } from "next/navigation";

import { coworkers, projectIssues, projects, runs } from "@/lib/coworker-data";

type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: IconType;
  count?: number;
  match?: "exact" | "prefix";
};

type SettingsNavItem = {
  section: string;
  label: string;
  icon: IconType;
};

type AppFrameProps = {
  children: ReactNode;
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

const topSearchStyle: CSSProperties = {
  width: "min(20rem, 34vw)",
};

const workspaceNavItems: WorkspaceNavItem[] = [
  { href: "/app", label: "Overview", icon: ChartBarSquareIcon, match: "exact" },
  { href: "/app/projects", label: "Projects", icon: FolderIcon, count: projects.length },
  { href: "/app/runs", label: "Runs", icon: PlayCircleIcon, count: runs.length },
  { href: "/app/coworkers", label: "Coworkers", icon: UserGroupIcon, count: coworkers.length },
];

const settingsNavItem: WorkspaceNavItem = {
  href: "/app/settings",
  label: "Settings",
  icon: Cog6ToothIcon,
};

const settingsNavItems = [
  { section: "organization", label: "Organization", icon: ChartBarSquareIcon },
  { section: "provider-account", label: "Provider account", icon: ServerStackIcon },
  { section: "github-apps", label: "GitHub Apps", icon: FolderIcon },
  { section: "repositories", label: "Repositories", icon: FolderIcon },
  { section: "billing", label: "Billing", icon: Cog6ToothIcon },
  { section: "security", label: "Security", icon: ShieldCheckIcon },
] as const satisfies readonly SettingsNavItem[];

type SettingsSectionSlug = (typeof settingsNavItems)[number]["section"];

const defaultSettingsSection: SettingsSectionSlug = "organization";

const projectStatusVariant: Record<string, StatusDotVariant> = {
  Healthy: "success",
  Syncing: "accent",
  "Needs setup": "warning",
};

function navigateTo(href: string): void {
  window.location.href = href;
}

function isWorkspaceItemSelected(item: WorkspaceNavItem, pathname: string): boolean {
  if (item.match === "exact") {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function AppFrame({ children }: AppFrameProps): ReactElement {
  const pathname = usePathname();
  const isSettingsRoute = pathname === "/app/settings";
  const runningRuns = runs.filter((run) => run.status === "Running").length;
  const [selectedSettingsSection, setSelectedSettingsSection] =
    useState<string>(defaultSettingsSection);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    setSelectedSettingsSection(section ?? defaultSettingsSection);
  }, [isSettingsRoute]);

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
                Capxul Alpha
              </Text>
            </HStack>
          }
          endContent={
            <>
              <Stack onClick={() => {}} style={topSearchStyle}>
                <TextInput
                  label="Search workspace"
                  isLabelHidden
                  size="sm"
                  width="100%"
                  startIcon={MagnifyingGlassIcon}
                  placeholder="Search issues, runs, coworkers..."
                  value=""
                  onChange={() => {}}
                />
              </Stack>
              <IconButton
                label="Notifications"
                tooltip="Notifications"
                variant="ghost"
                icon={<Icon icon={BellIcon} size="sm" />}
              />
              <DropdownMenu
                button={{
                  label: "Abu Usama",
                  variant: "secondary",
                  size: "sm",
                  icon: <Icon icon={UserCircleIcon} size="sm" />,
                }}
                menuWidth={260}
                items={[
                  { label: "Capxul Alpha", icon: BuildingOffice2Icon, onClick: () => {} },
                  { type: "divider" as const },
                  {
                    label: "Provider account",
                    onClick: () => navigateTo("/app/settings?section=provider-account"),
                  },
                  {
                    label: "Organization settings",
                    onClick: () => navigateTo("/app/settings?section=organization"),
                  },
                  {
                    label: "Security",
                    onClick: () => navigateTo("/app/settings?section=security"),
                  },
                ]}
              />
            </>
          }
        />
      }
      sideNav={
        <SideNav
          collapsible
          resizable={{ defaultWidth: 280, minWidth: 220, maxWidth: 380 }}
          footer={
            <SideNavSection title="Status" isHeaderHidden>
              <SideNavItem
                label="Provider account"
                icon={ServerStackIcon}
                href="/app/settings?section=provider-account"
                endContent={<StatusDot variant="warning" label="Needs attention" />}
              />
              <SideNavItem
                label={`${runningRuns} active runs`}
                icon={PlayCircleIcon}
                href="/app/runs"
                endContent={
                  <StatusDot variant={runningRuns > 0 ? "accent" : "neutral"} label="Run status" />
                }
              />
            </SideNavSection>
          }
        >
          {isSettingsRoute ? (
            <SideNavSection title="Settings">
              <SideNavItem
                label="Back to workspace"
                href="/app"
                icon={ArrowLeftIcon}
                isSelected={false}
              />
              {settingsNavItems.map((item) => (
                <SideNavItem
                  key={item.section}
                  label={item.label}
                  href={`/app/settings?section=${item.section}`}
                  icon={item.icon}
                  isSelected={item.section === selectedSettingsSection}
                  onClick={() => setSelectedSettingsSection(item.section)}
                />
              ))}
            </SideNavSection>
          ) : (
            <>
              <SideNavSection title="Workspace">
                {workspaceNavItems.map((item) => (
                  <SideNavItem
                    key={item.href}
                    label={item.label}
                    href={item.href}
                    icon={item.icon}
                    isSelected={isWorkspaceItemSelected(item, pathname)}
                    endContent={item.count ? item.count : undefined}
                  />
                ))}
                <SideNavItem
                  label={settingsNavItem.label}
                  href={settingsNavItem.href}
                  icon={settingsNavItem.icon}
                  isSelected={isWorkspaceItemSelected(settingsNavItem, pathname)}
                />
              </SideNavSection>
              <Divider />
              <SideNavSection title="Projects">
                {projects.map((project) => (
                  <SideNavItem
                    key={project.id}
                    label={project.name}
                    href={`/app/projects/${project.id}`}
                    icon={FolderIcon}
                    isSelected={pathname === `/app/projects/${project.id}`}
                    endContent={
                      <StatusDot
                        variant={projectStatusVariant[project.status] ?? "neutral"}
                        label={project.status}
                      />
                    }
                    collapsible={{ defaultIsCollapsed: pathname !== `/app/projects/${project.id}` }}
                  >
                    <VStack gap={0.5}>
                      <SideNavItem
                        label={`${project.openPullRequests} pull requests`}
                        href={`/app/projects/${project.id}`}
                      />
                      <SideNavItem
                        label={`${project.syncedIssues || projectIssues.filter((issue) => issue.projectId === project.id).length} issues`}
                        href={`/app/projects/${project.id}`}
                      />
                      <SideNavItem label={`${project.activeRuns} active runs`} href="/app/runs" />
                    </VStack>
                  </SideNavItem>
                ))}
              </SideNavSection>
              <SideNavSection title="Coworkers">
                {coworkers.map((coworker) => (
                  <SideNavItem
                    key={coworker.id}
                    label={coworker.name}
                    href={`/app/coworkers/${coworker.id}`}
                    icon={UserGroupIcon}
                    isSelected={pathname === `/app/coworkers/${coworker.id}`}
                    endContent={coworker.runsThisWeek}
                  />
                ))}
              </SideNavSection>
            </>
          )}
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
