/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  RUN_COLLECTION_ERROR_REFETCH_INTERVAL_MS,
  RUN_COLLECTION_REFETCH_INTERVAL_MS,
  refetchRunCollectionInterval,
} from "./run-collection-poll";

describe("refetchRunCollectionInterval", () => {
  test("polls at the normal cadence while healthy", () => {
    expect(refetchRunCollectionInterval({ state: { error: null } })).toBe(
      RUN_COLLECTION_REFETCH_INTERVAL_MS,
    );
  });

  test("keeps polling (slower) while erroring so the surface can self-heal (issue #53)", () => {
    // The critical regression: it must NOT return false. A stopped poll never fires a
    // success on recovery, so the reconnecting indicator would stick forever.
    const interval = refetchRunCollectionInterval({ state: { error: new Error("fetch failed") } });
    expect(interval).toBe(RUN_COLLECTION_ERROR_REFETCH_INTERVAL_MS);
    expect(interval).not.toBe(false);
    expect(typeof interval).toBe("number");
  });
});
