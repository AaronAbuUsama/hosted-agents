import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import OnboardingStep from "@/components/coworker/onboarding-step";
import { coworkerStatusBadgeVariants, coworkers } from "@/lib/coworker-data";

export default function CoworkersStepPage() {
  return (
    <OnboardingStep
      eyebrow="Step 4 of 5"
      title="Hire named coworkers"
      body="Start with Abu Bakr for code review and Umar for implementation work. Each coworker can have distinct GitHub identity, rules, and repo scope."
      primaryHref="/onboarding/rules"
      primaryLabel="Set starter rules"
    >
      <VStack gap={4}>
        {coworkers.map((coworker) => (
          <Card key={coworker.id} variant="muted" padding={4}>
            <VStack gap={2}>
              <HStack hAlign="between">
                <Heading level={2}>{coworker.name}</Heading>
                <Badge variant={coworkerStatusBadgeVariants[coworker.status]} label={coworker.status} />
              </HStack>
              <Text type="label">{coworker.role}</Text>
              <Text type="supporting" as="p">{coworker.githubAppName}</Text>
            </VStack>
          </Card>
        ))}
      </VStack>
    </OnboardingStep>
  );
}
