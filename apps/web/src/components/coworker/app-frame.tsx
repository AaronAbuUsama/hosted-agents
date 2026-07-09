"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import {
  SideNav,
  SideNavCollapseButton,
  SideNavSection,
  type SideNavImperativeCollapseHandle,
} from "@astryxdesign/core/SideNav";
import { HStack, Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TopNav } from "@astryxdesign/core/TopNav";
import {
  ArrowRightStartOnRectangleIcon,
  BuildingOffice2Icon,
  Cog6ToothIcon,
  SparklesIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

import AppSideNav from "@/components/coworker/app-side-nav";
import { authClient } from "@/lib/auth-client";

type AppFrameProps = {
  children: ReactNode;
  organizationLabel: string;
  userEmail?: string | null;
  userLabel: string;
};

const SETTINGS_PATH = "/app/settings";

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

export default function AppFrame({
  children,
  organizationLabel,
  userEmail,
  userLabel,
}: AppFrameProps): ReactElement {
  const router = useRouter();
  const sideNavHandleRef = useRef<SideNavImperativeCollapseHandle>(null);
  const [isSideNavCollapsed, setIsSideNavCollapsed] = useState(false);

  // The rail's data comes from TanStack DB live queries, which call
  // useSyncExternalStore without a server snapshot. Rendering them during the
  // SSR pass warns and reverts to client rendering, so we mount the live rail
  // only after the client has mounted; the SSR/first-paint pass shows the
  // static shell below.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

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
              {isMounted && !isSideNavCollapsed ? (
                <SideNavCollapseButton handleRef={sideNavHandleRef} />
              ) : null}
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
        isMounted ? (
          <AppSideNav
            handleRef={sideNavHandleRef}
            isCollapsed={isSideNavCollapsed}
            onCollapsedChange={setIsSideNavCollapsed}
          />
        ) : (
          <SideNav resizable={{ defaultWidth: 300, minWidth: 240, maxWidth: 420 }}>
            <SideNavSection title="Workspace" isHeaderHidden>
              <span />
            </SideNavSection>
          </SideNav>
        )
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
