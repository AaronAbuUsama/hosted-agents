import { env } from "@hosted-agents/env/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "@hosted-agents/db/schema/index";

export function createDb() {
  const client = createClient({
    url: env.DATABASE_URL,
  });

  // Multiple processes (API + review worker + implementation worker) share one
  // SQLite file. WAL lets readers and writers coexist; busy_timeout makes
  // write-write contention wait instead of throwing SQLITE_BUSY (which was
  // crashing worker claim transactions). Both are no-ops on non-file backends,
  // so fire-and-forget is safe.
  if (env.DATABASE_URL.startsWith("file:")) {
    void client
      .executeMultiple("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;")
      .catch(() => {
        // Pragmas are best-effort: a locked db at boot just means another
        // process already configured them.
      });
  }

  return drizzle({ client, schema });
}

export const db = createDb();
