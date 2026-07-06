import { Grid } from "@astryxdesign/core/Grid";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
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

const setupSteps = ["Organization", "Provider", "GitHub", "Coworkers", "Rules"] as const;

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
  const activeStep = Number(eyebrow.match(/\d+/)?.[0] ?? "1");

  return (
    <main className="min-h-dvh bg-body p-6 text-primary">
      <VStack gap={6} className="mx-auto w-full max-w-6xl">
        <HStack hAlign="between" vAlign="center" wrap="wrap">
          <Link href="/" isStandalone>
            Coworker
          </Link>
          <Text type="supporting" color="secondary">
            {eyebrow}
          </Text>
        </HStack>

        <Section variant="section" padding={0}>
          <VStack gap={0}>
            <section className="border-b border-border px-5 py-4">
              <HStack gap={4} wrap="wrap">
                {setupSteps.map((step, index) => {
                  const stepNumber = index + 1;
                  const isComplete = stepNumber < activeStep;
                  const isCurrent = stepNumber === activeStep;

                  return (
                    <HStack key={step} gap={1.5} vAlign="center">
                      <StatusDot
                        variant={isComplete ? "success" : isCurrent ? "accent" : "neutral"}
                        label={step}
                      />
                      <Text
                        type="supporting"
                        color={isCurrent ? "primary" : "secondary"}
                        weight={isCurrent ? "semibold" : undefined}
                      >
                        {step}
                      </Text>
                    </HStack>
                  );
                })}
              </HStack>
            </section>

            <Grid columns={{ minWidth: 280, repeat: "fit" }} gap={0} align="stretch">
              <section className="border-b border-border p-5 lg:border-b-0 lg:border-r">
                <VStack gap={4}>
                  <VStack gap={1}>
                    <Text type="label" color="accent">
                      Setup
                    </Text>
                    <Heading level={1}>{title}</Heading>
                  </VStack>
                  <Text type="large" as="p" color="secondary">
                    {body}
                  </Text>
                  <HStack gap={4} wrap="wrap">
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
              </section>

              <Section variant="muted" padding={5}>
                {children}
              </Section>
            </Grid>
          </VStack>
        </Section>
      </VStack>
    </main>
  );
}
