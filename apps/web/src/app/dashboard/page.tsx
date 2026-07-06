import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Code Review Dashboard</h1>
        <p className="text-sm text-muted-foreground">Welcome {session.user.name}</p>
      </div>
      <Dashboard session={session} />
    </div>
  );
}
