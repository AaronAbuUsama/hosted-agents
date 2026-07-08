import type { CSSProperties, ReactNode } from "react";

import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack, Stack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";

type OnboardingStepProps = {
  step: 1 | 2 | 3;
  title: string;
  body: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children?: ReactNode;
};

const setupSteps = ["Organization", "GitHub", "Provider"] as const;

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  padding: "var(--spacing-6)",
  backgroundColor: "var(--color-background-body)",
};

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: "72rem",
  marginInline: "auto",
};

const stepBarStyle: CSSProperties = {
  paddingBlock: "var(--spacing-4)",
  paddingInline: "var(--spacing-5)",
};

export default function OnboardingStep({
  step,
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  children,
}: OnboardingStepProps) {
  const eyebrow = `Step ${step} of ${setupSteps.length}`;

  return (
    <VStack style={pageStyle}>
      <VStack gap={6} style={shellStyle}>
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
            <Stack style={stepBarStyle}>
              <HStack gap={4} wrap="wrap">
                {setupSteps.map((label, index) => {
                  const stepNumber = index + 1;
                  const isComplete = stepNumber < step;
                  const isCurrent = stepNumber === step;

                  return (
                    <HStack key={label} gap={1.5} vAlign="center">
                      <StatusDot
                        variant={isComplete ? "success" : isCurrent ? "accent" : "neutral"}
                        label={label}
                      />
                      <Text
                        type="supporting"
                        color={isCurrent ? "primary" : "secondary"}
                        weight={isCurrent ? "semibold" : undefined}
                      >
                        {label}
                      </Text>
                    </HStack>
                  );
                })}
              </HStack>
            </Stack>

            <Divider />

            <Grid columns={{ minWidth: 280, repeat: "fit" }} gap={0} align="stretch">
              <Section variant="section" padding={5}>
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
                  {primaryHref && primaryLabel ? (
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
                  ) : null}
                </VStack>
              </Section>

              <Section variant="muted" padding={5}>
                {children}
              </Section>
            </Grid>
          </VStack>
        </Section>
      </VStack>
    </VStack>
  );
}
