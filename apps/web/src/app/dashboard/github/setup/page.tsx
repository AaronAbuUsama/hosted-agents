import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import {
  createGitHubSetupNextPath,
  createOrganizationHref,
  firstSearchParam,
} from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

import OnboardingStep from "@/components/coworker/onboarding-step";

import GitHubSetupClient from "./setup.client";

type SetupSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GitHubSetupPage({
  searchParams,
}: {
  searchParams: SetupSearchParams;
}) {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  const params = await searchParams;
  const installationId = firstSearchParam(params.installation_id);
  const setupAction = firstSearchParam(params.setup_action);
  const state = firstSearchParam(params.state);
  const activeOrganization = await client.activeOrganization();

  if (!activeOrganization) {
    redirect(
      createOrganizationHref(createGitHubSetupNextPath({ installationId, setupAction, state })),
    );
  }

  return (
    <OnboardingStep
      step={2}
      title="Connect GitHub"
      body="Install the Reviewer GitHub App and link its installation to this organization. Reviewer runs start from the repositories it can see."
    >
      <GitHubSetupClient installationId={installationId} setupAction={setupAction} state={state} />
    </OnboardingStep>
  );
}
