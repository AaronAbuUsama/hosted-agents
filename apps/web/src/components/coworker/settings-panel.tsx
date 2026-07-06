"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Divider } from "@astryxdesign/core/Divider";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import CoworkerPage from "@/components/coworker/coworker-page";

const settingsSectionSlugs = [
  "organization",
  "provider-account",
  "github-apps",
  "repositories",
  "billing",
  "security",
] as const;

type SettingsSectionSlug = (typeof settingsSectionSlugs)[number];

type SettingsPanelProps = {
  section?: string;
};

type SettingsSectionProps = {
  title: string;
  description: string;
  children: ReactNode;
};

function getSettingsSection(section?: string): SettingsSectionSlug {
  const match = settingsSectionSlugs.find((slug) => slug === section);
  return match ?? "organization";
}

function ignoreReadOnlyChange(): void {}

export default function SettingsPanel({ section }: SettingsPanelProps): ReactElement {
  const activeSection = getSettingsSection(section);
  const [organizationName, setOrganizationName] = useState("Capxul Alpha");
  const [workspaceSlug, setWorkspaceSlug] = useState("capxul-alpha");
  const [domain, setDomain] = useState("coworker.tech/capxul-alpha");
  const [providerName, setProviderName] = useState("OpenAI/Codex");
  const [providerStatus, setProviderStatus] = useState("Needs credential");
  const [reviewerApp, setReviewerApp] = useState("Abu Bakr by Coworker");
  const [implementerApp, setImplementerApp] = useState("Umar by Coworker");
  const [branchScope, setBranchScope] = useState("main, develop");
  const [invoiceEmail, setInvoiceEmail] = useState("ops@capxul.com");
  const [requireSso, setRequireSso] = useState(false);
  const [restrictSandboxNetwork, setRestrictSandboxNetwork] = useState(true);
  const [autoCreateLabels, setAutoCreateLabels] = useState(true);
  const [syncPullRequests, setSyncPullRequests] = useState(true);
  const [syncIssues, setSyncIssues] = useState(false);

  let sectionContent: ReactElement;

  switch (activeSection) {
    case "organization":
      sectionContent = (
        <SettingsSection
          title="Organization"
          description="Name the workspace and control the public organization identity used across Coworker."
        >
          <TextInput label="Organization name" value={organizationName} onChange={setOrganizationName} />
          <TextInput label="Workspace slug" value={workspaceSlug} onChange={setWorkspaceSlug} />
          <TextInput label="Workspace URL" value={domain} onChange={setDomain} />
        </SettingsSection>
      );
      break;
    case "provider-account":
      sectionContent = (
        <SettingsSection
          title="Provider account"
          description="Connect the model provider Umar uses when opening implementation sandboxes."
        >
          <TextInput label="Provider" value={providerName} onChange={setProviderName} />
          <TextInput label="Credential status" value={providerStatus} onChange={setProviderStatus} status={{ type: "warning" }} />
          <CheckboxInput
            label="Allow implementation runs after provider checks pass"
            description="Umar can start coding only after the provider account is connected and scoped to this organization."
            value={restrictSandboxNetwork}
            onChange={setRestrictSandboxNetwork}
          />
        </SettingsSection>
      );
      break;
    case "github-apps":
      sectionContent = (
        <SettingsSection
          title="GitHub Apps"
          description="Named coworkers use separate GitHub App identities while sharing the same workspace policy."
        >
          <TextInput label="Reviewer app" value={reviewerApp} onChange={setReviewerApp} />
          <TextInput label="Implementer app" value={implementerApp} onChange={setImplementerApp} />
          <CheckboxInput
            label="Sync pull request review events"
            description="Pull requests appear in project work when Abu Bakr starts or completes a review."
            value={syncPullRequests}
            onChange={setSyncPullRequests}
          />
        </SettingsSection>
      );
      break;
    case "repositories":
      sectionContent = (
        <SettingsSection
          title="Repositories"
          description="Set defaults for linked projects before choosing per-project modes."
        >
          <TextInput label="Default branch scope" value={branchScope} onChange={setBranchScope} />
          <CheckboxInput
            label="Create Coworker labels when missing"
            description="Coworker can create namespaced labels such as coworker:ready and coworker:in-progress."
            value={autoCreateLabels}
            onChange={setAutoCreateLabels}
          />
          <CheckboxInput
            label="Enable issue sync by default"
            description="New projects can opt into a Linear-style issue table and board when Umar is installed."
            value={syncIssues}
            onChange={setSyncIssues}
          />
        </SettingsSection>
      );
      break;
    case "billing":
      sectionContent = (
        <SettingsSection title="Billing" description="Control workspace billing ownership and usage notifications.">
          <TextInput
            label="Plan"
            value="Team preview"
            onChange={ignoreReadOnlyChange}
            isDisabled
            disabledMessage="Plan changes are not available in this local preview."
          />
          <TextInput label="Invoice email" value={invoiceEmail} onChange={setInvoiceEmail} type="email" />
          <TextInput
            label="Usage owner"
            value="Operations"
            onChange={ignoreReadOnlyChange}
            isDisabled
            disabledMessage="Usage ownership is managed by the organization owner."
          />
        </SettingsSection>
      );
      break;
    case "security":
      sectionContent = (
        <SettingsSection
          title="Security"
          description="Guard access to code, provider credentials, and sandbox execution."
        >
          <CheckboxInput
            label="Require SSO for workspace members"
            description="Members must authenticate through the organization identity provider."
            value={requireSso}
            onChange={setRequireSso}
          />
          <CheckboxInput
            label="Restrict sandbox network access"
            description="Implementation sandboxes can only reach approved package registries and provider APIs."
            value={restrictSandboxNetwork}
            onChange={setRestrictSandboxNetwork}
          />
          <CheckboxInput
            label="Audit exports and generated patches"
            description="Record every exported patch, pull request comment, and provider request for review."
            value
            onChange={ignoreReadOnlyChange}
          />
        </SettingsSection>
      );
      break;
  }

  return (
    <CoworkerPage width="default">
      <section className="mx-auto w-full max-w-5xl">{sectionContent}</section>
    </CoworkerPage>
  );
}

function SettingsSection({ title, description, children }: SettingsSectionProps): ReactElement {
  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Text type="label" color="accent">
          Settings
        </Text>
        <Heading level={1}>{title}</Heading>
        <Text type="supporting" color="secondary" as="p">
          {description}
        </Text>
      </VStack>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="p-5">
          <FormLayout direction="horizontal-labels">{children}</FormLayout>
        </div>
        <Divider />
        <div className="px-5 py-4">
          <HStack hAlign="end">
            <Button label="Save changes" variant="primary" />
          </HStack>
        </div>
      </section>
    </VStack>
  );
}
