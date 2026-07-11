import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AppFrame from "@/components/coworker/app-frame";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_ORGANIZATION_NEXT_PATH, createOrganizationHref } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

export default async function CoworkerAppLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();

  let session: Awaited<ReturnType<typeof authClient.getSession>> | null = null;
  try {
    session = await authClient.getSession({
      fetchOptions: {
        headers: requestHeaders,
        throw: true,
      },
    });
  } catch {
    // The API is unreachable (or rejected the request) during SSR. A full page load
    // must not 500 the whole app (issue #53: unguarded `throw: true` turned any
    // hard navigation while the API was down into an unhandled "fetch failed").
    // Send the user to /login, which lives outside this layout and renders without
    // the API. `redirect` throws NEXT_REDIRECT, which propagates out of this catch.
    redirect("/login");
  }

  if (!session?.user) {
    redirect("/login");
  }

  const activeOrganization = await client.activeOrganization();

  if (!activeOrganization) {
    redirect(createOrganizationHref(DEFAULT_ORGANIZATION_NEXT_PATH));
  }

  const userLabel = session.user.name ?? session.user.email ?? "Account";
  const userEmail = session.user.email ?? null;
  const organizationLabel = activeOrganization.name ?? "Organization";

  return (
    <AppFrame organizationLabel={organizationLabel} userEmail={userEmail} userLabel={userLabel}>
      {children}
    </AppFrame>
  );
}
