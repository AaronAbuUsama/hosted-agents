import type { AppRouterClient } from "@hosted-agents/api/routers/index";
import { env } from "@hosted-agents/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";

import {
  connectionRetry,
  connectionRetryDelay,
  createConnectionStatusReporter,
  suppressesGlobalErrorToast,
} from "@/lib/connection-status";
import { notify } from "@/lib/toast-bridge";

export function createQueryClient() {
  // One reporter per client folds every query's error/success into a single calm
  // "reconnecting" indicator instead of a red toast per failed query (issue #53).
  const connection = createConnectionStatusReporter({ notify });
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // A query that renders its own error inline (the issues board's 403 "no Issues
        // access" state) opts out of the global toast — otherwise the same failure
        // shows twice (issue #53). Connectivity is still covered by its sibling queries
        // (e.g. the revision poll), which keep driving the reconnecting indicator.
        if (suppressesGlobalErrorToast(query.meta)) {
          return;
        }
        connection.reportError(error);
      },
      // Any success while we were reconnecting means the API is back — clears the
      // indicator so the board self-heals without a manual reload.
      onSuccess: () => connection.reportSuccess(),
    }),
    defaultOptions: {
      queries: {
        // Give a transient blip a bounded, backed-off chance to recover before it is
        // ever allowed to surface. App errors (403/404/…) fail fast and surface at
        // once; collections that opt out with `retry: false` keep their own policy.
        retry: connectionRetry,
        retryDelay: connectionRetryDelay,
      },
    },
  });
}

export const queryClient = createQueryClient();

export const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_SERVER_URL}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
  headers: async () => {
    if (typeof window !== "undefined") {
      return {};
    }

    const { headers } = await import("next/headers");
    return Object.fromEntries(await headers());
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
