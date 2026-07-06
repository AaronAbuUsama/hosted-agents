import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import CoworkerPage from "@/components/coworker/coworker-page";

import {
  coworkers,
  projects,
  projectLabelSetupBadgeVariants,
  projectStatusBadgeVariants,
  runs,
  setupSteps,
  setupStepStatusBadgeVariants,
  summaryRunStatusBadgeVariants,
} from "@/lib/coworker-data";

export default function AppOverviewPage() {
  const activeRuns = runs.filter((run) => run.status === "Running" || run.status === "Needs review");
  const issueBoardProjects = projects.filter((project) => project.modes.includes("Issue board"));
  const openPullRequests = projects.reduce((total, project) => total + project.openPullRequests, 0);

  return (
    <CoworkerPage>
        <HStack hAlign="between" vAlign="start">
          <VStack gap={2}>
            <Text type="label" color="accent">
              Workspace
            </Text>
            <Heading level={1}>Project operations</Heading>
            <Text type="supporting" as="p">
              Link repositories, choose branch scope, run pull request review, and enable project boards only where the implementer is installed.
            </Text>
          </VStack>
          <Link href="/onboarding/github" isStandalone>
            Link repository
          </Link>
        </HStack>

        <section className="grid gap-4 md:grid-cols-4">
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Linked projects</Text>
              <Text type="display-3">{projects.length}</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Open pull requests</Text>
              <Text type="display-3">{openPullRequests}</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Active runs</Text>
              <Text type="display-3">{activeRuns.length}</Text>
            </VStack>
          </Card>
          <Card padding={5}>
            <VStack gap={2}>
              <Text type="label">Project boards</Text>
              <Text type="display-3">{issueBoardProjects.length}</Text>
              <Text type="supporting">Enabled only with implementer setup.</Text>
            </VStack>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card padding={6}>
            <VStack gap={4}>
              <HStack hAlign="between" vAlign="center">
                <Heading level={2}>Projects</Heading>
                <Link href="/app/projects" isStandalone>
                  View all projects
                </Link>
              </HStack>
              {projects.map((project) => (
                <Card key={project.id} variant="muted" padding={4}>
                  <HStack hAlign="between" vAlign="center">
                    <VStack gap={1}>
                      <Link href={`/app/projects/${project.id}`} isStandalone>
                        {project.name}
                      </Link>
                      <Text type="supporting">
                        {project.branches.join(", ")} / {project.modes.join(" + ")}
                      </Text>
                    </VStack>
                    <VStack gap={1}>
                      <Badge variant={projectStatusBadgeVariants[project.status]} label={project.status} />
                      <Badge variant={projectLabelSetupBadgeVariants[project.labelSetup]} label={project.labelSetup} />
                    </VStack>
                  </HStack>
                </Card>
              ))}
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
                <HStack key={run.id} hAlign="between" vAlign="center">
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
              );
            })}
          </VStack>
        </Card>
    </CoworkerPage>
  );
}
