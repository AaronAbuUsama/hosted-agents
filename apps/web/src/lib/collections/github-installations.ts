import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { client, queryClient } from "@/utils/orpc";

// Repositories change far less often than runs, so this polls on a slower
// cadence than the run collection (which refreshes every 5s).
const INSTALLATIONS_REFETCH_INTERVAL_MS = 30_000;

export type GitHubInstallationRecord = Awaited<
  ReturnType<typeof client.githubInstallations>
>[number];

export type GitHubRepositoryRecord = GitHubInstallationRecord["repositories"][number];

function refetchInstallationsInterval(query: { state: { error: unknown } }): number | false {
  return query.state.error ? false : INSTALLATIONS_REFETCH_INTERVAL_MS;
}

export const githubInstallationsCollection = createCollection(
  queryCollectionOptions<GitHubInstallationRecord, Error, ["github-installations"], string>({
    id: "github-installations",
    queryKey: ["github-installations"],
    queryFn: async () => client.githubInstallations({}),
    queryClient,
    getKey: (installation) => installation.id,
    staleTime: INSTALLATIONS_REFETCH_INTERVAL_MS,
    retry: false,
    refetchInterval: refetchInstallationsInterval,
  }),
);
