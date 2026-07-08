import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { client } from "@/utils/orpc";

import ReviewerClient from "./reviewer.client";

export default async function ReviewerPage(): Promise<ReactElement> {
  const [configuration, installations] = await Promise.all([
    client.workerConfiguration(),
    client.githubInstallations(),
  ]);

  return (
    <CoworkerPage variant="workspace" width="full">
      <ReviewerClient initialConfiguration={configuration} installations={installations} />
    </CoworkerPage>
  );
}
