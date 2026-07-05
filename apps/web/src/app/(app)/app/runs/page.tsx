import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

import { coworkers, runs, runStatusBadgeVariants, type RunStatus } from "@/lib/coworker-data";

const statusOrder: RunStatus[] = ["Running", "Needs review", "Blocked", "Completed"];

export default function RunsPage() {
  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <HStack hAlign="between" vAlign="start">
          <VStack gap={2}>
            <Text type="label" color="accent">
              Runs
            </Text>
            <Heading level={1}>Live and historical coworker runs</Heading>
            <Text type="supporting" as="p">
              Grouped by operational state so blockers and live work stay visible.
            </Text>
          </VStack>
          <Badge variant="neutral" label={`${runs.length} runs`} />
        </HStack>

        {statusOrder.map((status) => {
          const groupedRuns = runs.filter((run) => run.status === status);
          if (groupedRuns.length === 0) {
            return null;
          }

          return (
            <section key={status} className="grid gap-3">
              <HStack gap={2} vAlign="center">
                <Heading level={2}>{status}</Heading>
                <Badge variant={runStatusBadgeVariants[status]} label={groupedRuns.length} />
              </HStack>
              <Card padding={0}>
                <VStack gap={0}>
                  {groupedRuns.map((run) => {
                    const coworker = coworkers.find((item) => item.id === run.coworkerId);
                    return (
                      <article key={run.id} className="border-b border-border px-4 py-3 last:border-b-0">
                        <HStack hAlign="between" vAlign="center">
                          <VStack gap={1}>
                            <Link href={`/app/runs/${run.id}`} isStandalone>
                              {run.title}
                            </Link>
                            <Text type="supporting">
                              {coworker?.name} / {run.repo} / {run.branch}
                            </Text>
                          </VStack>
                          <HStack gap={6} vAlign="center">
                            <Text type="supporting">{run.started}</Text>
                            <Text type="supporting" hasTabularNumbers>
                              {run.duration}
                            </Text>
                            <Text maxLines={1}>{run.result}</Text>
                          </HStack>
                        </HStack>
                      </article>
                    );
                  })}
                </VStack>
              </Card>
            </section>
          );
        })}
      </VStack>
    </main>
  );
}
