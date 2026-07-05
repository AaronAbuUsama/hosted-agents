import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-body text-primary">
      <VStack gap={8}>
        <header className="border-b border-border bg-surface">
          <HStack hAlign="between" vAlign="center" className="mx-auto max-w-7xl px-6 py-4">
            <Link href="/" isStandalone>
              coworker.tech
            </Link>
            <Text type="supporting">Named AI coworkers for GitHub teams</Text>
          </HStack>
        </header>
        <section className="mx-auto grid w-full max-w-6xl gap-8 px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <VStack gap={4}>
            <Text type="label" color="accent">
              Setup path
            </Text>
            <Text type="display-3" as="p">
              Account, organization, provider account, GitHub Apps, starter rules.
            </Text>
            <Text type="supporting" as="p">
              Signup starts a guided setup before the dashboard. Signin returns you to the operations shell.
            </Text>
          </VStack>
          {children}
        </section>
      </VStack>
    </main>
  );
}
