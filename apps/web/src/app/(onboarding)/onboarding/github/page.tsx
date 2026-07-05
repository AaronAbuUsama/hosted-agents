import { Badge } from "@astryxdesign/core/Badge";
import { VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import OnboardingStep from "@/components/coworker/onboarding-step";

export default function GitHubStepPage() {
  return (
    <OnboardingStep
      eyebrow="Step 3 of 5"
      title="Connect GitHub"
      body="Each named coworker can be installed as a separate GitHub App so comments, checks, and avatars appear as that person."
      primaryHref="/onboarding/coworkers"
      primaryLabel="Choose coworkers"
    >
      <VStack gap={4}>
        <Heading level={2}>GitHub organization</Heading>
        <Text type="supporting" as="p">Install apps into selected repositories and branch scopes.</Text>
        <Badge variant="blue" label="Ready to connect" />
      </VStack>
    </OnboardingStep>
  );
}
