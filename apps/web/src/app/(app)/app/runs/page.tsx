import type { ReactElement } from "react";
import CoworkerPage from "@/components/coworker/coworker-page";

import RunsTableClient from "@/components/coworker/runs-table-client";

export default function RunsPage(): ReactElement {
  return (
    <CoworkerPage variant="workspace" width="full">
      <RunsTableClient />
    </CoworkerPage>
  );
}
