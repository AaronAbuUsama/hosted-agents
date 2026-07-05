import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

type OnboardingStepProps = {
  eyebrow: string;
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children?: React.ReactNode;
};

export default function OnboardingStep({
  eyebrow,
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  children,
}: OnboardingStepProps) {
  return (
    <main className="min-h-dvh bg-body p-6 text-primary">
      <VStack gap={8}>
        <HStack hAlign="between" vAlign="center">
          <Link href="/" isStandalone>
            coworker.tech
          </Link>
          <Badge variant="blue" label="Setup" />
        </HStack>

        <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <VStack gap={4}>
            <Text type="label" color="accent">
              {eyebrow}
            </Text>
            <Heading level={1}>{title}</Heading>
            <Text type="large" as="p" color="secondary">
              {body}
            </Text>
            <HStack gap={4}>
              <Link href={primaryHref} isStandalone>
                {primaryLabel}
              </Link>
              {secondaryHref && secondaryLabel ? (
                <Link href={secondaryHref} isStandalone>
                  {secondaryLabel}
                </Link>
              ) : null}
            </HStack>
          </VStack>

          <Card padding={6}>{children}</Card>
        </section>
      </VStack>
    </main>
  );
}
