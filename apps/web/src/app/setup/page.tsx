import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import {
  APP_LANDING_PATH,
  createOrganizationHref,
  getMissingSetupPath,
} from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

// Single post-auth entry point: resolves the workspace setup state and sends
// the user to the first missing step, or straight into the app when setup is
// complete. Login, signup, and every setup step's "continue" all route here so
// no page needs to hardcode what comes next.
export default async function SetupResolverPage(): Promise<never> {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  const setupState = await client.setupState();

  if (!setupState.organization) {
    redirect(createOrganizationHref("/setup"));
  }

  redirect(
    getMissingSetupPath({
      hasGitHubInstallation: setupState.hasGitHubInstallation,
      hasProviderCredential: setupState.hasProviderCredential,
    }) ?? APP_LANDING_PATH,
  );
}
