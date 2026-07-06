import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

export default function MarketingPage() {
  return (
    <main className="min-h-dvh bg-body text-primary">
      <section className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-6 py-12">
        <VStack gap={8} className="w-full text-center">
          <VStack gap={4} className="w-full">
            <Text type="label" color="secondary">
              Coworker
            </Text>
            <Heading level={1} className="w-full text-balance">
              AI Coworkers for GitHub
            </Heading>
            <p
              className="mx-auto max-w-xl text-pretty text-center text-lg leading-7"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Install the reviewer and coder apps, connect repositories, and kick off runs from one
              focused workspace.
            </p>
          </VStack>

          <HStack gap={3} hAlign="center" vAlign="center" className="flex-wrap">
            <Button label="Get Started" href="/signup" variant="primary" size="lg" />
            <Button label="Sign In" href="/login" variant="secondary" size="lg" />
          </HStack>
        </VStack>
      </section>
    </main>
  );
}
