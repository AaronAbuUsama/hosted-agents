"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Badge } from "@astryxdesign/core/Badge";
import type { IconType } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TopNav } from "@astryxdesign/core/TopNav";
import {
  BoltIcon,
  ChartBarSquareIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  PlayCircleIcon,
  ServerStackIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { usePathname } from "next/navigation";

import { coworkers, runs } from "@/lib/coworker-data";

type NavItem = {
  href: string;
  label: string;
  icon: IconType;
  count?: number;
};

const navItems: NavItem[] = [
  { href: "/app", label: "Overview", icon: ChartBarSquareIcon },
  { href: "/app/runs", label: "Runs", icon: PlayCircleIcon, count: runs.length },
  { href: "/app/coworkers", label: "Coworkers", icon: UserGroupIcon, count: coworkers.length },
  { href: "/app/rules", label: "Rules", icon: BoltIcon },
  { href: "/app/settings", label: "Settings", icon: Cog6ToothIcon },
];

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShell
      variant="elevated"
      contentPadding={0}
      topNav={
        <TopNav
          label="Coworker workspace navigation"
          heading={
            <Link href="/" isStandalone>
              Coworker
            </Link>
          }
          endContent={
            <HStack gap={4} vAlign="center">
              <Text type="supporting">Capxul Alpha</Text>
              <Badge variant="green" label="Provider pending" />
              <Link href="/login" isStandalone>
                Sign in
              </Link>
            </HStack>
          }
        />
      }
      sideNav={
        <SideNav
          header={
            <SideNavHeading
              heading="coworker.tech"
              superheading="Workspace"
              subheading="Named AI coworkers"
              headingHref="/app"
            />
          }
          footer={
            <VStack gap={2}>
              <HStack gap={2} vAlign="center">
                <CommandLineIcon width={16} height={16} />
                <Text type="label">Sandbox runner</Text>
              </HStack>
              <Text type="supporting" as="p">
                Runs execute in isolated sandboxes before posting back to GitHub.
              </Text>
            </VStack>
          }
          collapsible={{ defaultIsCollapsed: false }}
        >
          <SideNavSection title="Operate">
            {navItems.map((item) => (
              <SideNavItem
                key={item.href}
                label={item.label}
                href={item.href}
                icon={item.icon}
                isSelected={pathname === item.href || (item.href !== "/app" && pathname.startsWith(`${item.href}/`))}
                endContent={item.count ? <Badge label={item.count} /> : undefined}
              />
            ))}
          </SideNavSection>
          <SideNavSection title="Connections">
            <SideNavItem label="GitHub Apps" href="/app/settings" icon={ServerStackIcon} />
          </SideNavSection>
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
}
