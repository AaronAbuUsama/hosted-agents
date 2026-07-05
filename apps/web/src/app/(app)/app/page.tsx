import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import {
  coworkers,
  rules,
  runs,
  setupSteps,
  setupStepStatusBadgeVariants,
  summaryRunStatusBadgeVariants,
} from "@/lib/coworker-data";

export default function AppOverviewPage() {
  const activeRuns = runs.filter((run) => run.status === "Running" || run.status === "Needs review");

  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <HStack hAlign="between" vAlign="start">
          <VStack gap={2}>
            <Text type="label" color="accent">
              Operations dashboard
            </Text>
            <Heading level={1}>Coworker control room</Heading>
            <Text type="supporting" as="p">
              Watch named coworkers, GitHub installs, provider readiness, active rules, and live runs from one desktop shell.
            </Text>
          </VStack>
          <Link href="/onboarding/coworkers" isStandalone>
            Hire coworkers
          </Link>
        </HStack>

        <section className="grid gap-4 md:grid-cols-4">
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Active runs</Text>
              <Text type="display-3">{activeRuns.length}</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Coworkers</Text>
              <Text type="display-3">{coworkers.length}</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Coworker rules</Text>
              <Text type="display-3">{rules.length}</Text>
              <Text type="supporting">Configured inside coworker profiles.</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Setup checks</Text>
              <Text type="display-3">{setupSteps.length}</Text>
            </VStack>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card padding={6}>
            <VStack gap={4}>
              <HStack hAlign="between" vAlign="center">
                <Heading level={2}>Recent runs</Heading>
                <Link href="/app/runs" isStandalone>
                  View all runs
                </Link>
              </HStack>
              {runs.slice(0, 4).map((run) => {
                const coworker = coworkers.find((item) => item.id === run.coworkerId);
                return (
                  <Card key={run.id} variant="muted" padding={4}>
                    <HStack hAlign="between" vAlign="center">
                      <VStack gap={1}>
                        <Link href={`/app/runs/${run.id}`} isStandalone>
                          {run.title}
                        </Link>
                        <Text type="supporting">
                          {coworker?.name} / {run.repo} / {run.trigger}
                        </Text>
                      </VStack>
                      <Badge variant={summaryRunStatusBadgeVariants[run.status]} label={run.status} />
                    </HStack>
                  </Card>
                );
              })}
            </VStack>
          </Card>

          <Card padding={6}>
            <VStack gap={4}>
              <Heading level={2}>Setup health</Heading>
              {setupSteps.map((step) => (
                <VStack key={step.title} gap={1}>
                  <HStack hAlign="between">
                    <Text weight="semibold">{step.title}</Text>
                    <Badge variant={setupStepStatusBadgeVariants[step.status]} label={step.status} />
                  </HStack>
                  <Text type="supporting" as="p">
                    {step.detail}
                  </Text>
                </VStack>
              ))}
            </VStack>
          </Card>
        </section>
      </VStack>
    </main>
  );
}
