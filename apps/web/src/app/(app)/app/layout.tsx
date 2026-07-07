import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AppFrame from "@/components/coworker/app-frame";
import { authClient } from "@/lib/auth-client";

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

  return <AppFrame>{children}</AppFrame>;
}
