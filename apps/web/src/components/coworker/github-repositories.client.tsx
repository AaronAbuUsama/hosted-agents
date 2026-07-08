"use client";

import { useState, type ReactElement } from "react";

import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { useToast } from "@astryxdesign/core/Toast";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";

import { client } from "@/utils/orpc";

type GitHubInstallation = Awaited<ReturnType<typeof client.githubInstallations>>[number];
type InstallationRepository = GitHubInstallation["repositories"][number];

export default function GitHubRepositoriesClient({
  installations,
}: {
  installations: GitHubInstallation[];
}): ReactElement {
  return (
    <VStack gap={4}>
      {installations.map((installation) => (
        <InstallationCard key={installation.id} installation={installation} />
      ))}
    </VStack>
  );
}

function InstallationCard({ installation }: { installation: GitHubInstallation }): ReactElement {
  const isConnected = installation.status === "connected";
  const repositoryCount = installation.repositoryCount;

  return (
    <Card>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={3}>
          <StackItem size="fill">
            <VStack gap={0}>
              <Text type="body" weight="semibold">
                {installation.accountLogin ?? "GitHub installation"}
              </Text>
              <Text type="supporting" color="secondary">
                {repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"} linked
              </Text>
            </VStack>
          </StackItem>
          <Token
            label={isConnected ? "Connected" : installation.status}
            color={isConnected ? "green" : "gray"}
            size="sm"
          />
        </HStack>
        {installation.repositories.length > 0 ? (
          <>
            <Divider />
            <VStack gap={2}>
              <Text type="label" color="secondary">
                Repositories the reviewer runs on
              </Text>
              {installation.repositories.map((repository) => (
                <RepositoryToggle key={repository.id} repository={repository} />
              ))}
            </VStack>
          </>
        ) : null}
      </VStack>
    </Card>
  );
}

function RepositoryToggle({ repository }: { repository: InstallationRepository }): ReactElement {
  const showToast = useToast();
  const [selected, setSelected] = useState(repository.selected);

  const description = `${repository.private ? "Private" : "Public"}${
    repository.defaultBranch ? ` · ${repository.defaultBranch}` : ""
  }`;

  return (
    <Switch
      label={repository.fullName}
      description={description}
      labelPosition="start"
      labelSpacing="spread"
      value={selected}
      changeAction={async (checked) => {
        try {
          const updated = await client.setRepositorySelected({
            repositoryId: repository.id,
            selected: checked,
          });
          setSelected(updated.selected);
          showToast({
            body: updated.selected
              ? `${updated.fullName} enabled for reviewer runs.`
              : `${updated.fullName} disabled. New pull requests will be ignored.`,
          });
        } catch (error) {
          showToast({
            body: error instanceof Error ? error.message : "Could not update the repository.",
            type: "error",
          });
          // Rethrow so the Switch reverts its optimistic state to `value`.
          throw error;
        }
      }}
    />
  );
}
