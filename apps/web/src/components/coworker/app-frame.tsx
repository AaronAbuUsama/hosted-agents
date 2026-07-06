"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import type { IconType } from "@astryxdesign/core/Icon";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
  ArrowLeftIcon,
  ChartBarSquareIcon,
  Cog6ToothIcon,
  FolderIcon,
  PlayCircleIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { usePathname } from "next/navigation";

import { coworkers, projects, runs } from "@/lib/coworker-data";

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

const workspaceNavItems: WorkspaceNavItem[] = [
  { href: "/app", label: "Overview", icon: ChartBarSquareIcon, match: "exact" },
  { href: "/app/projects", label: "Projects", icon: FolderIcon, count: projects.length },
  { href: "/app/runs", label: "Runs", icon: PlayCircleIcon, count: runs.length },
  { href: "/app/coworkers", label: "Coworkers", icon: UserGroupIcon, count: coworkers.length },
];

const settingsNavItem: WorkspaceNavItem = { href: "/app/settings", label: "Settings", icon: Cog6ToothIcon };

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
  const [selectedSettingsSection, setSelectedSettingsSection] = useState<string>(defaultSettingsSection);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    setSelectedSettingsSection(section ?? defaultSettingsSection);
  }, [isSettingsRoute]);
  return (
    <AppShell
      contentPadding={0}
      sideNav={
        <SideNav
          header={<SideNavHeading heading="Capxul Alpha" headingHref="/app" subheading="Coworker workspace" />}
          footer={
            <VStack gap={1}>
              <Text type="label">Sync healthy</Text>
              <Text type="supporting" color="secondary">
                {projects.length} projects · {runningRuns} active runs
              </Text>
            </VStack>
          }
          collapsible={{ defaultIsCollapsed: false }}
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
              </SideNavSection>
              <SideNavSection title="Configure">
                <SideNavItem
                  label={settingsNavItem.label}
                  href={settingsNavItem.href}
                  icon={settingsNavItem.icon}
                  isSelected={isWorkspaceItemSelected(settingsNavItem, pathname)}
                />
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
            <div data-coworker-app-outlet className="h-full min-h-0 overflow-hidden">
              {children}
            </div>
          </LayoutContent>
        }
      />
    </AppShell>
  );
}
