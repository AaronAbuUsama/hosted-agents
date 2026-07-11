import { headers } from "next/headers";
import { redirect } from "next/navigation";

import OnboardingStep from "@/components/coworker/onboarding-step";
import { authClient } from "@/lib/auth-client";
import { isReviewerInstallation } from "@/lib/github-installations";
import { SETUP_GITHUB_PATH, createOrganizationHref } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

import ProviderSetupClient from "./provider-setup.client";

export default async function ProviderStepPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  const activeOrganization = await client.activeOrganization();

  if (!activeOrganization) {
    redirect(createOrganizationHref("/onboarding/provider"));
  }

  const githubInstallations = await client.githubInstallations({
    organizationId: activeOrganization.id,
  });
  const hasLinkedReviewer = githubInstallations.some(
    (installation) =>
      isReviewerInstallation(installation) &&
      installation.status === "connected" &&
      installation.repositoryCount > 0,
  );

  if (!hasLinkedReviewer) {
    redirect(SETUP_GITHUB_PATH);
  }

  return (
    <OnboardingStep
      step={3}
      title="Connect a provider account"
      body="Coworker uses your provider account for Codex/OpenAI work. Credentials are scoped to the organization and used by every reviewer run."
      secondaryHref="/app/settings"
      secondaryLabel="Configure later"
    >
      <ProviderSetupClient />
    </OnboardingStep>
  );
}
