"use client";

import type { ReactElement } from "react";

import { Center } from "@astryxdesign/core/Center";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import dynamic from "next/dynamic";

const RunsTable = dynamic(() => import("./runs-table"), {
  ssr: false,
  loading: RunsTableLoading,
});

function RunsTableLoading(): ReactElement {
  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" padding={4}>
          <Center>
            <Text type="supporting" color="secondary">
              Loading runs…
            </Text>
          </Center>
        </LayoutContent>
      }
    />
  );
}

export default function RunsTableClient(): ReactElement {
  return <RunsTable />;
}
