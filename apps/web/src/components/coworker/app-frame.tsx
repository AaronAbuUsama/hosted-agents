"use client";

import { useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import type { IconType } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import {
  SideNav,
  SideNavCollapseButton,
  SideNavItem,
  SideNavSection,
  type SideNavImperativeCollapseHandle,
} from "@astryxdesign/core/SideNav";
import { HStack, Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TopNav } from "@astryxdesign/core/TopNav";
import {
  BuildingOffice2Icon,
  Cog6ToothIcon,
  KeyIcon,
  PlayCircleIcon,
  SparklesIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { usePathname } from "next/navigation";

import { getWorkspaceNavItems } from "@/lib/organization-routing";

type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: IconType;
};

type AppFrameProps = {
  children: ReactNode;
  organizationLabel: string;
  userLabel: string;
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

const workspaceNavItems: WorkspaceNavItem[] = getWorkspaceNavItems().map((item) => ({
  ...item,
  icon: PlayCircleIcon,
}));

function isWorkspaceItemSelected(item: WorkspaceNavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function navigateTo(href: string): void {
  window.location.href = href;
}

export default function AppFrame({
  children,
  organizationLabel,
  userLabel,
}: AppFrameProps): ReactElement {
  const pathname = usePathname();
  const sideNavHandleRef = useRef<SideNavImperativeCollapseHandle>(null);
  const [isSideNavCollapsed, setIsSideNavCollapsed] = useState(false);

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
                icon={BuildingOffice2Icon}
                onClick={() => navigateTo("/app/settings")}
              />
              <Divider />
              <DropdownMenuItem
                label="Provider account"
                icon={KeyIcon}
                onClick={() => navigateTo("/onboarding/provider")}
              />
              <DropdownMenuItem
                label="Organization settings"
                icon={Cog6ToothIcon}
                onClick={() => navigateTo("/app/settings")}
              />
              <DropdownMenuItem
                label="Runs"
                icon={PlayCircleIcon}
                onClick={() => navigateTo("/app/runs")}
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
          resizable={{ defaultWidth: 280, minWidth: 220, maxWidth: 380 }}
        >
          <SideNavSection title="Workspace">
            {workspaceNavItems.map((item) => (
              <SideNavItem
                key={item.href}
                label={item.label}
                href={item.href}
                icon={item.icon}
                isSelected={isWorkspaceItemSelected(item, pathname)}
              />
            ))}
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
