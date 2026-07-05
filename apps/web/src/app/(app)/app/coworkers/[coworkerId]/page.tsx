import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { notFound } from "next/navigation";

import {
  coworkerStatusBadgeVariants,
  coworkers,
  rules,
  ruleStatusBadgeVariants,
  runs,
  summaryRunStatusBadgeVariants,
} from "@/lib/coworker-data";

type CoworkerProfilePageProps = {
  params: Promise<{ coworkerId: string }>;
};

export default async function CoworkerProfilePage({ params }: CoworkerProfilePageProps) {
  const { coworkerId } = await params;
  const coworker = coworkers.find((item) => item.id === coworkerId);

  if (!coworker) {
    notFound();
  }

  const coworkerRuns = runs.filter((run) => run.coworkerId === coworker.id);
  const coworkerRules = rules.filter((rule) => rule.coworkerId === coworker.id);

  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <HStack hAlign="between" vAlign="start">
          <VStack gap={2}>
            <Link href="/app/coworkers" isStandalone>
              Back to coworkers
            </Link>
            <Heading level={1}>{coworker.name}</Heading>
            <Text type="label">{coworker.role}</Text>
            <Text type="supporting">{coworker.email} / {coworker.githubAppName}</Text>
          </VStack>
          <Badge variant={coworkerStatusBadgeVariants[coworker.status]} label={coworker.status} />
        </HStack>

        <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <Card padding={6}>
            <VStack gap={4}>
              <Heading level={2}>Identity</Heading>
              <Text as="p">{coworker.purpose}</Text>
              <VStack gap={2}>
                <Text type="supporting">GitHub App</Text>
                <Text>{coworker.githubAppName}</Text>
              </VStack>
              <VStack gap={2}>
                <Text type="supporting">Installed repositories</Text>
                <Text>{coworker.repos}</Text>
              </VStack>
              <VStack gap={2}>
                <Text type="supporting">Runs this week</Text>
                <Text>{coworker.runsThisWeek}</Text>
              </VStack>
            </VStack>
          </Card>

          <VStack gap={4}>
            <Card padding={6}>
              <VStack gap={4}>
                <VStack gap={1}>
                  <Heading level={2}>Rules for {coworker.name}</Heading>
                  <Text type="supporting" as="p">
                    Rules define when this coworker wakes up, which repositories are in scope, and what guardrails apply.
                  </Text>
                </VStack>
                {coworkerRules.map((rule) => (
                  <Card key={rule.id} variant="muted" padding={4}>
                    <VStack gap={3}>
                      <HStack hAlign="between">
                        <Text weight="semibold">{rule.name}</Text>
                        <Badge variant={ruleStatusBadgeVariants[rule.status]} label={rule.status} />
                      </HStack>
                      <section className="grid gap-3 md:grid-cols-3">
                        <VStack gap={1}>
                          <Text type="label">When</Text>
                          <Text type="supporting" as="p">{rule.trigger}</Text>
                        </VStack>
                        <VStack gap={1}>
                          <Text type="label">Where</Text>
                          <Text type="supporting" as="p">{rule.scope}</Text>
                        </VStack>
                        <VStack gap={1}>
                          <Text type="label">Guardrail</Text>
                          <Text type="supporting" as="p">{rule.guardrail}</Text>
                        </VStack>
                      </section>
                      <Text as="p">{rule.action}</Text>
                    </VStack>
                  </Card>
                ))}
              </VStack>
            </Card>

            <Card padding={6}>
              <VStack gap={4}>
                <Heading level={2}>Recent runs</Heading>
                {coworkerRuns.map((run) => (
                  <HStack key={run.id} hAlign="between" vAlign="center">
                    <Link href={`/app/runs/${run.id}`} isStandalone>
                      {run.title}
                    </Link>
                    <Badge variant={summaryRunStatusBadgeVariants[run.status]} label={run.status} />
                  </HStack>
                ))}
              </VStack>
            </Card>
          </VStack>
        </section>
      </VStack>
    </main>
  );
}
