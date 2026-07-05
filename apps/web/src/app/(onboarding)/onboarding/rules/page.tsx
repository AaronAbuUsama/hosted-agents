import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import OnboardingStep from "@/components/coworker/onboarding-step";
import { rules, ruleStatusBadgeVariants } from "@/lib/coworker-data";

export default function RulesStepPage() {
  return (
    <OnboardingStep
      eyebrow="Step 5 of 5"
      title="Create starter rules"
      body="Rules decide which GitHub events wake each coworker, where they can act, and what guardrails they must respect."
      primaryHref="/app"
      primaryLabel="Go to dashboard"
      secondaryHref="/app/rules"
      secondaryLabel="Review rules"
    >
      <VStack gap={4}>
        {rules.map((rule) => (
          <Card key={rule.id} variant="muted" padding={4}>
            <VStack gap={2}>
              <Heading level={2}>{rule.name}</Heading>
              <Text type="supporting" as="p">{rule.trigger}</Text>
              <Badge variant={ruleStatusBadgeVariants[rule.status]} label={rule.status} />
            </VStack>
          </Card>
        ))}
      </VStack>
    </OnboardingStep>
  );
}
