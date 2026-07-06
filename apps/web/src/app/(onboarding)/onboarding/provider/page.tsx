import { Badge } from "@astryxdesign/core/Badge";
import { VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import OnboardingStep from "@/components/coworker/onboarding-step";

export default function ProviderStepPage() {
  return (
    <OnboardingStep
      eyebrow="Step 2 of 5"
      title="Connect a provider account"
      body="Coworker uses the customer provider account for Codex/OpenAI work. Credentials are scoped by organization and can later be overridden per coworker."
      primaryHref="/onboarding/github"
      primaryLabel="Continue to GitHub"
      secondaryHref="/app/settings"
      secondaryLabel="Configure later"
    >
      <VStack gap={4}>
        <Heading level={2}>OpenAI / Codex</Heading>
        <Text type="supporting" as="p">Required before implementation sandboxes can run.</Text>
        <Badge variant="warning" label="Needs attention" />
      </VStack>
    </OnboardingStep>
  );
}
