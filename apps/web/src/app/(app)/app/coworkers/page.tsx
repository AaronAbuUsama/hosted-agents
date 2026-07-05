import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import { coworkerStatusBadgeVariants, coworkers, runs } from "@/lib/coworker-data";

export default function CoworkersPage() {
  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <VStack gap={2}>
          <Text type="label" color="accent">
            Coworkers
          </Text>
          <Heading level={1}>Named people, GitHub identities, real jobs</Heading>
          <Text type="supporting" as="p">
            Customers hire named coworkers from coworker.tech. Each one can have a distinct GitHub App, avatar, check name, rules, and run history.
          </Text>
        </VStack>

        <section className="grid gap-4 lg:grid-cols-2">
          {coworkers.map((coworker) => {
            const coworkerRuns = runs.filter((run) => run.coworkerId === coworker.id);
            return (
              <Card key={coworker.id} padding={6}>
                <VStack gap={5}>
                  <HStack hAlign="between" vAlign="start">
                    <VStack gap={2}>
                      <Heading level={2}>{coworker.name}</Heading>
                      <Text type="label">{coworker.role}</Text>
                      <Text type="supporting">{coworker.email}</Text>
                    </VStack>
                    <Badge variant={coworkerStatusBadgeVariants[coworker.status]} label={coworker.status} />
                  </HStack>
                  <Text as="p">{coworker.purpose}</Text>
                  <section className="grid gap-3 md:grid-cols-3">
                    <VStack gap={1}>
                      <Text type="supporting">Repos</Text>
                      <Text type="display-3">{coworker.repos}</Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="supporting">Runs this week</Text>
                      <Text type="display-3">{coworker.runsThisWeek}</Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="supporting">Recent runs</Text>
                      <Text type="display-3">{coworkerRuns.length}</Text>
                    </VStack>
                  </section>
                  <VStack gap={2}>
                    <Text type="label">Default triggers</Text>
                    <HStack gap={2} wrap="wrap">
                      {coworker.triggers.map((trigger) => (
                        <Badge key={trigger} variant="neutral" label={trigger} />
                      ))}
                    </HStack>
                  </VStack>
                  <Link href={`/app/coworkers/${coworker.id}`} isStandalone>
                    Open {coworker.name}'s profile
                  </Link>
                </VStack>
              </Card>
            );
          })}
        </section>
      </VStack>
    </main>
  );
}
