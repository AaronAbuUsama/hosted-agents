import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import {
  mapAgentRunArtifactToArtifactRow,
  mapAgentRunToRunRow,
  type AgentRunEventApiRecord,
  type RunArtifactViewRow,
  type RunViewModelRow,
} from "@/lib/run-view-model";
import { client, queryClient } from "@/utils/orpc";

const RUN_COLLECTION_REFETCH_INTERVAL_MS = 5_000;

function refetchRunCollectionInterval(query: { state: { error: unknown } }): number | false {
  return query.state.error ? false : RUN_COLLECTION_REFETCH_INTERVAL_MS;
}

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
    staleTime: RUN_COLLECTION_REFETCH_INTERVAL_MS,
    retry: false,
    refetchInterval: refetchRunCollectionInterval,
  }),
);

export function createAgentRunEventsCollection(runId: string) {
  return createCollection(
    queryCollectionOptions<AgentRunEventApiRecord, Error, ["agent-run-events", string], string>({
      id: `agent-run-events:${runId}`,
      queryKey: ["agent-run-events", runId],
      queryFn: async () => client.agentRunEvents({ runId }),
      queryClient,
      getKey: (event) => event.id,
      staleTime: RUN_COLLECTION_REFETCH_INTERVAL_MS,
      retry: false,
      refetchInterval: refetchRunCollectionInterval,
    }),
  );
}

export function createAgentRunArtifactsCollection(runId: string) {
  return createCollection(
    queryCollectionOptions<RunArtifactViewRow, Error, ["agent-run-artifacts", string], string>({
      id: `agent-run-artifacts:${runId}`,
      queryKey: ["agent-run-artifacts", runId],
      queryFn: async () => {
        const records = await client.agentRunArtifacts({ runId });
        return records.map(mapAgentRunArtifactToArtifactRow);
      },
      queryClient,
      getKey: (artifact) => artifact.id,
      staleTime: RUN_COLLECTION_REFETCH_INTERVAL_MS,
      retry: false,
      refetchInterval: refetchRunCollectionInterval,
    }),
  );
}
