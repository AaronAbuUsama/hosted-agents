import type { ReactElement } from "react";
import CoworkerPage from "@/components/coworker/coworker-page";

import RunsTable from "@/components/coworker/runs-table";

export default function RunsPage(): ReactElement {
  return (
    <CoworkerPage variant="workspace" width="full">
      <RunsTable />
    </CoworkerPage>
  );
}
