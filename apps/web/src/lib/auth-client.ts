import { env } from "@hosted-agents/env/web";
import { createAuthClient } from "better-auth/react";
import { organizationClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_SERVER_URL,
  plugins: [usernameClient(), organizationClient()],
});
