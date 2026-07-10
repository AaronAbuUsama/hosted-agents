"use client";

import { useState, type ReactElement } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { PlusIcon } from "@heroicons/react/24/outline";

import IssuesBoard from "./issues-board";
// Runs is the secondary tab. Scope it to this project by the repository's
// "owner/name" label (the run view-model's group key) so project A's Runs tab
// never shows project B's runs (spec #19, story 27).
import RunsTable from "./runs-table";

// Issue-centric: opening a repository lands on its issues board; runs are the
// secondary execution log (see issue #19).
type ProjectView = "issues" | "runs";

type RepositoryWorkspaceProps = {
  // The repository's "owner/name" label. Runs are grouped by this in the run
  // view-model, so it doubles as the filter key for this project's runs.
  fullName: string;
  // github_repository.id + the active organization — the board queries by these.
  repositoryId: string;
  organizationId: string;
};

const REVIEWER_PATH = "/app/reviewer";

export default function RepositoryWorkspace({
  fullName,
  repositoryId,
  organizationId,
}: RepositoryWorkspaceProps): ReactElement {
  const [view, setView] = useState<ProjectView>("issues");

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
                    Issues grouped by pipeline stage. Runs are the execution log.
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
              <Tab value="issues" label="Issues" />
              <Tab value="runs" label="Runs" />
            </TabList>
          </VStack>
        </LayoutHeader>
      }
      content={
        view === "issues" ? (
          <IssuesBoard organizationId={organizationId} repositoryId={repositoryId} />
        ) : (
          <RunsTable repoFilter={fullName} />
        )
      }
    />
  );
}
