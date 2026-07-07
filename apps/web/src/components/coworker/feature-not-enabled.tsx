import type { ReactElement } from "react";

import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { HStack } from "@astryxdesign/core/Stack";

import CoworkerPage from "@/components/coworker/coworker-page";

type FeatureNotEnabledProps = {
  featureName: string;
  description: string;
};

export default function FeatureNotEnabled({
  featureName,
  description,
}: FeatureNotEnabledProps): ReactElement {
  return (
    <CoworkerPage variant="workspace" width="full">
      <Center height="fill" minHeight={480}>
        <EmptyState
          title={`${featureName} is not enabled yet`}
          description={description}
          headingLevel={1}
          actions={
            <HStack gap={3} wrap="wrap" hAlign="center">
              <Link href="/app/runs" isStandalone>
                View reviewer runs
              </Link>
              <Link href="/dashboard/github/setup" isStandalone>
                Continue GitHub setup
              </Link>
            </HStack>
          }
        />
      </Center>
    </CoworkerPage>
  );
}
