import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import { coworkerStatusBadgeVariants, coworkers, runs, setupSteps } from "@/lib/coworker-data";

const workflow = [
  "Create your Coworker organization",
  "Connect provider credentials",
  "Install named GitHub Apps",
  "Set rules and watch runs",
];

export default function MarketingPage() {
  return (
    <main className="min-h-dvh bg-body text-primary">
      <VStack gap={10}>
        <header className="border-b border-border bg-surface">
          <HStack hAlign="between" vAlign="center" className="mx-auto max-w-7xl px-6 py-4">
            <Text type="label">coworker.tech</Text>
            <HStack gap={5} vAlign="center">
              <Link href="/login" isStandalone>
                Sign in
              </Link>
              <Link href="/signup" isStandalone>
                Hire your first coworker
              </Link>
            </HStack>
          </HStack>
        </header>

        <section className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1.15fr_0.85fr]">
          <VStack gap={6}>
            <Badge variant="blue" label="GitHub-native AI coworkers" />
            <Heading level={1}>Your next engineer already has a GitHub account.</Heading>
            <Text type="large" as="p" color="secondary">
              Coworker lets teams hire named AI coworkers who review pull requests, implement assigned issues, and report back from inside GitHub as themselves.
            </Text>
            <HStack gap={4}>
              <Link href="/signup" isStandalone>
                Start onboarding
              </Link>
              <Link href="/app/coworkers" isStandalone>
                View coworker roster
              </Link>
            </HStack>
          </VStack>

          <Card padding={6}>
            <VStack gap={5}>
              <Text type="label" color="secondary">
                Initial coworker roster
              </Text>
              {coworkers.map((coworker) => (
                <Card key={coworker.id} variant="muted" padding={4}>
                  <VStack gap={2}>
                    <HStack hAlign="between" vAlign="center">
                      <Heading level={2}>{coworker.name}</Heading>
                      <Badge variant={coworkerStatusBadgeVariants[coworker.status]} label={coworker.status} />
                    </HStack>
                    <Text type="label">{coworker.role}</Text>
                    <Text type="supporting" as="p">
                      {coworker.email} / {coworker.githubAppName}
                    </Text>
                    <Text as="p">{coworker.purpose}</Text>
                  </VStack>
                </Card>
              ))}
            </VStack>
          </Card>
        </section>

        <section className="mx-auto grid max-w-7xl gap-4 px-6 md:grid-cols-4">
          {workflow.map((step, index) => (
            <Card key={step} padding={5}>
              <VStack gap={3}>
                <Text type="label" color="accent">
                  Step {index + 1}
                </Text>
                <Text weight="semibold">{step}</Text>
              </VStack>
            </Card>
          ))}
        </section>

        <section className="mx-auto grid max-w-7xl gap-4 px-6 pb-12 md:grid-cols-3">
          <Card padding={5}>
            <VStack gap={2}>
              <Heading level={2}>Runs</Heading>
              <Text type="display-3">{runs.length}</Text>
              <Text type="supporting">Live, completed, blocked, and review-needed executions.</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Heading level={2}>Setup health</Heading>
              <Text type="display-3">{setupSteps.length}</Text>
              <Text type="supporting">Organization, provider, GitHub, and rule checkpoints.</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Heading level={2}>GitHub identity</Heading>
              <Text type="display-3">2</Text>
              <Text type="supporting">Named GitHub Apps, avatars, checks, and comment authors.</Text>
            </VStack>
          </Card>
        </section>
      </VStack>
    </main>
  );
}
