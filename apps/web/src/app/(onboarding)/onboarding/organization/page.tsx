import { headers } from "next/headers";
import { redirect } from "next/navigation";

import OnboardingStep from "@/components/coworker/onboarding-step";
import { authClient } from "@/lib/auth-client";
import { firstSearchParam, normalizeOrganizationNextPath } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

import OrganizationForm from "./organization-form";

type OrganizationSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrganizationStepPage({
  searchParams,
}: {
  searchParams: OrganizationSearchParams;
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
  const nextPath = normalizeOrganizationNextPath(firstSearchParam(params.next));
  const activeOrganization = await client.activeOrganization();

  if (activeOrganization) {
    redirect(nextPath);
  }

  return (
    <OnboardingStep
      step={1}
      title="Create your Coworker organization"
      body="The organization owns provider credentials, GitHub installations, rules, workers, runs, and billing."
    >
      <OrganizationForm nextPath={nextPath} />
    </OnboardingStep>
  );
}
