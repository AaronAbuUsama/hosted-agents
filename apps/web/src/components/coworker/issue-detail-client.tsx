"use client";

import type { ReactElement } from "react";

import { Center } from "@astryxdesign/core/Center";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import dynamic from "next/dynamic";

// The issue detail reads live issue + comment data through a client-only query,
// so it is loaded without SSR — mirroring the repository workspace boundary.
const IssueDetail = dynamic(() => import("./issue-detail"), {
  ssr: false,
  loading: IssueDetailLoading,
});

function IssueDetailLoading(): ReactElement {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" padding={4}>
          <Center height="fill" minHeight={240}>
            <Text type="supporting" color="secondary">
              Loading issue…
            </Text>
          </Center>
        </LayoutContent>
      }
    />
  );
}

export default function IssueDetailClient({
  organizationId,
  repositoryId,
  fullName,
  issueNumber,
}: {
  organizationId: string;
  repositoryId: string;
  fullName: string;
  issueNumber: number;
}): ReactElement {
  return (
    <IssueDetail
      organizationId={organizationId}
      repositoryId={repositoryId}
      fullName={fullName}
      issueNumber={issueNumber}
    />
  );
}
