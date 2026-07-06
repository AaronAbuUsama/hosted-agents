import { Badge } from "@astryxdesign/core/Badge";
import { VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import OnboardingStep from "@/components/coworker/onboarding-step";

export default function OrganizationStepPage() {
  return (
    <OnboardingStep
      eyebrow="Step 1 of 5"
      title="Create your Coworker organization"
      body="The organization owns provider credentials, GitHub installations, rules, coworkers, runs, and billing."
      primaryHref="/onboarding/provider"
      primaryLabel="Continue to provider account"
    >
      <VStack gap={4}>
        <Heading level={2}>Capxul Alpha</Heading>
        <Text type="supporting" as="p">Workspace slug: capxul-alpha</Text>
        <Badge variant="green" label="Ready" />
      </VStack>
    </OnboardingStep>
  );
}
