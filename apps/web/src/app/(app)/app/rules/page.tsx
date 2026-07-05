import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import { coworkers, rules, ruleStatusBadgeVariants } from "@/lib/coworker-data";

export default function RulesPage() {
  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <VStack gap={2}>
          <Text type="label" color="accent">
            Rules
          </Text>
          <Heading level={1}>When should each coworker act?</Heading>
          <Text type="supporting" as="p">
            Rules connect GitHub events, repositories, branches, coworkers, actions, and guardrails.
          </Text>
        </VStack>

        <section className="grid gap-4">
          {rules.map((rule) => {
            const coworker = coworkers.find((item) => item.id === rule.coworkerId);
            return (
              <Card key={rule.id} padding={6}>
                <VStack gap={4}>
                  <HStack hAlign="between" vAlign="start">
                    <VStack gap={1}>
                      <Heading level={2}>{rule.name}</Heading>
                      <Text type="supporting">{coworker?.name} / {coworker?.role}</Text>
                    </VStack>
                    <Badge variant={ruleStatusBadgeVariants[rule.status]} label={rule.status} />
                  </HStack>
                  <section className="grid gap-4 md:grid-cols-4">
                    <VStack gap={1}>
                      <Text type="label">When</Text>
                      <Text type="supporting" as="p">{rule.trigger}</Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="label">Where</Text>
                      <Text type="supporting" as="p">{rule.scope}</Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="label">Action</Text>
                      <Text type="supporting" as="p">{rule.action}</Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="label">Guardrail</Text>
                      <Text type="supporting" as="p">{rule.guardrail}</Text>
                    </VStack>
                  </section>
                </VStack>
              </Card>
            );
          })}
        </section>
      </VStack>
    </main>
  );
}
