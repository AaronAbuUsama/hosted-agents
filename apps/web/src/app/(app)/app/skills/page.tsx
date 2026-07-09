import type { ReactElement } from "react";

import CoworkerPage from "@/components/coworker/coworker-page";
import { client } from "@/utils/orpc";

import SkillsClient from "./skills.client";

export default async function SkillsPage(): Promise<ReactElement> {
  const configuration = await client.workerConfiguration();

  return (
    <CoworkerPage variant="workspace" width="full">
      <SkillsClient initialSkills={configuration.skills} />
    </CoworkerPage>
  );
}
