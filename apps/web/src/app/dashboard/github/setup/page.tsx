import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import GitHubSetupClient from "./setup.client";

type SetupSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

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

  return (
    <GitHubSetupClient
      installationId={first(params.installation_id)}
      setupAction={first(params.setup_action)}
      state={first(params.state)}
    />
  );
}
