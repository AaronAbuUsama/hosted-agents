import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";

const settings = [
  {
    title: "Organization",
    status: "Connected",
    detail: "Capxul Alpha owns coworker installs, rules, provider credentials, and billing.",
  },
  {
    title: "Provider account",
    status: "Needs attention",
    detail: "Connect OpenAI/Codex credentials before Umar can run implementation sandboxes.",
  },
  {
    title: "GitHub Apps",
    status: "Partial",
    detail: "Install Abu Bakr and Umar separately so comments, checks, and avatars stay distinct.",
  },
  {
    title: "Billing",
    status: "Not configured",
    detail: "Billing will meter sandbox runs and provider usage once accounts are live.",
  },
];

export default function SettingsPage() {
  return (
    <main className="min-h-full bg-body p-6 text-primary">
      <VStack gap={6}>
        <VStack gap={2}>
          <Text type="label" color="accent">
            Settings
          </Text>
          <Heading level={1}>Organization and integrations</Heading>
          <Text type="supporting" as="p">
            Provider credentials, GitHub installations, and account-level setup live here.
          </Text>
        </VStack>

        <Card padding={0}>
          <VStack gap={0}>
            {settings.map((setting) => (
              <article key={setting.title} className="border-b border-border px-5 py-4 last:border-b-0">
                <HStack hAlign="between" vAlign="center">
                  <VStack gap={1}>
                    <Heading level={2}>{setting.title}</Heading>
                    <Text type="supporting" as="p">{setting.detail}</Text>
                  </VStack>
                  <Badge variant={setting.status === "Connected" ? "green" : "yellow"} label={setting.status} />
                </HStack>
              </article>
            ))}
          </VStack>
        </Card>
      </VStack>
    </main>
  );
}
