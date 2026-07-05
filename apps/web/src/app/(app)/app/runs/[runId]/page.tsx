import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { notFound } from "next/navigation";

import { coworkers, runs, runStatusBadgeVariants } from "@/lib/coworker-data";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const run = runs.find((item) => item.id === runId);

  if (!run) {
    notFound();
  }

  const coworker = coworkers.find((item) => item.id === run.coworkerId);

  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <HStack hAlign="between" vAlign="start">
          <VStack gap={2}>
            <Link href="/app/runs" isStandalone>
              Back to runs
            </Link>
            <Heading level={1}>{run.title}</Heading>
            <Text type="supporting" as="p">
              {coworker?.name} / {coworker?.role} / {run.repo} / {run.trigger}
            </Text>
          </VStack>
          <Badge variant={runStatusBadgeVariants[run.status]} label={run.status} />
        </HStack>

        <section className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <Card padding={6}>
            <VStack gap={5}>
              <Heading level={2}>Run transcript</Heading>
              {run.transcript.map((entry) => (
                <Card key={`${entry.speaker}-${entry.message}`} variant="muted" padding={4}>
                  <VStack gap={2}>
                    <Text type="label">{entry.speaker}</Text>
                    <Text as="p">{entry.message}</Text>
                  </VStack>
                </Card>
              ))}
            </VStack>
          </Card>

          <VStack gap={4}>
            <Card padding={5}>
              <VStack gap={3}>
                <Heading level={2}>Run facts</Heading>
                <VStack gap={2}>
                  <Text type="supporting">Repository</Text>
                  <Text>{run.repo}</Text>
                </VStack>
                <VStack gap={2}>
                  <Text type="supporting">Branch</Text>
                  <Text>{run.branch}</Text>
                </VStack>
                <VStack gap={2}>
                  <Text type="supporting">Started</Text>
                  <Text>{run.started}</Text>
                </VStack>
                <VStack gap={2}>
                  <Text type="supporting">Duration</Text>
                  <Text>{run.duration}</Text>
                </VStack>
              </VStack>
            </Card>

            <Card padding={5}>
              <VStack gap={3}>
                <Heading level={2}>Timeline</Heading>
                {run.timeline.map((item, index) => (
                  <HStack key={item} gap={3} vAlign="start">
                    <Badge variant={index === run.timeline.length - 1 ? runStatusBadgeVariants[run.status] : "neutral"} label={index + 1} />
                    <Text as="p">{item}</Text>
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
