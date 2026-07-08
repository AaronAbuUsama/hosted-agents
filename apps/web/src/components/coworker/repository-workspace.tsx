"use client";

import { useState, type ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { PlusIcon } from "@heroicons/react/24/outline";

import { RunsTableView } from "./runs-table";

type ProjectView = "runs" | "issues";

type RepositoryWorkspaceProps = {
  // The repository's "owner/name" label. Runs are grouped by this in the run
  // view-model, so it doubles as the filter key for this project's runs.
  fullName: string;
};

const REVIEWER_PATH = "/app/reviewer";

export default function RepositoryWorkspace({ fullName }: RepositoryWorkspaceProps): ReactElement {
  const [view, setView] = useState<ProjectView>("runs");

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={3}>
            <HStack gap={4} vAlign="start" hAlign="between" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Text type="label" color="accent">
                    Project
                  </Text>
                  <Heading level={1}>{fullName}</Heading>
                  <Text type="supporting" color="secondary">
                    Code reviews today; issue work arrives with the coding agent.
                  </Text>
                </VStack>
              </StackItem>
              <Button
                label="New review"
                variant="primary"
                size="sm"
                href={REVIEWER_PATH}
                icon={<Icon icon={PlusIcon} size="sm" />}
              />
            </HStack>
            <TabList value={view} onChange={(next) => setView(next as ProjectView)} size="sm">
              <Tab value="runs" label="Runs" />
              <Tab value="issues" label="Issues" />
            </TabList>
          </VStack>
        </LayoutHeader>
      }
      content={
        view === "runs" ? (
          <RunsTableView repoFilter={fullName} />
        ) : (
          <LayoutContent role="main" isScrollable padding={4}>
            <EmptyState
              title="Issues arrive with the coding agent"
              description="This is where the implementation worker's issue board will live — issues grouped by pipeline stage. The Reviewer runs on pull requests; the coding agent will run on issues."
              headingLevel={2}
            />
          </LayoutContent>
        )
      }
    />
  );
}
