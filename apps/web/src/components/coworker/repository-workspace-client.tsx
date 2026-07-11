"use client";

import type { ReactElement } from "react";

import { Center } from "@astryxdesign/core/Center";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import dynamic from "next/dynamic";

// The project workspace reads the live runs collection, which is client-only, so
// it is loaded without SSR — mirroring the Runs table client boundary.
const RepositoryWorkspace = dynamic(() => import("./repository-workspace"), {
  ssr: false,
  loading: RepositoryWorkspaceLoading,
});

function RepositoryWorkspaceLoading(): ReactElement {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" padding={4}>
          <Center>
            <Text type="supporting" color="secondary">
              Loading project…
            </Text>
          </Center>
        </LayoutContent>
      }
    />
  );
}

export default function RepositoryWorkspaceClient({
  fullName,
  repositoryId,
  organizationId,
  installationSettingsUrl = null,
}: {
  fullName: string;
  repositoryId: string;
  organizationId: string;
  installationSettingsUrl?: string | null;
}): ReactElement {
  return (
    <RepositoryWorkspace
      fullName={fullName}
      repositoryId={repositoryId}
      organizationId={organizationId}
      installationSettingsUrl={installationSettingsUrl}
    />
  );
}
