import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AppFrame from "@/components/coworker/app-frame";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_ORGANIZATION_NEXT_PATH, createOrganizationHref } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

export default async function CoworkerAppLayout({ children }: { children: React.ReactNode }) {
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
