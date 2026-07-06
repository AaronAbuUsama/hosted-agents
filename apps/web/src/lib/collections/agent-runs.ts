import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { mapAgentRunToRunRow, type RunViewModelRow } from "@/lib/run-view-model";
import { client, queryClient } from "@/utils/orpc";

export const agentRunsCollection = createCollection(
  queryCollectionOptions<RunViewModelRow, Error, ["agent-runs"], string>({
    id: "agent-runs",
    queryKey: ["agent-runs"],
    queryFn: async () => {
      const records = await client.agentRuns({});
      return records.map(mapAgentRunToRunRow);
    },
    queryClient,
    getKey: (run) => run.id,
    staleTime: 5_000,
    refetchInterval: 5_000,
  }),
);
