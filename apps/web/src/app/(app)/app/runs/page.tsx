import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { Banner } from "@astryxdesign/core/Banner";
import { Link } from "@astryxdesign/core/Link";

import CoworkerPage from "@/components/coworker/coworker-page";
import { SETUP_GITHUB_PATH, SETUP_PROVIDER_PATH } from "@/lib/organization-routing";
import { client } from "@/utils/orpc";

import RunsTableClient from "@/components/coworker/runs-table-client";

export default async function RunsPage(): Promise<ReactElement> {
  const setupState = await client.setupState();

  // Without a linked GitHub installation there is nothing runs-related to
  // show, so finish setup first. A missing provider credential only blocks
  // future runs — keep the page reachable and surface it as a banner.
  if (setupState.organization && !setupState.hasGitHubInstallation) {
    redirect(SETUP_GITHUB_PATH);
  }

  const isProviderMissing = Boolean(setupState.organization) && !setupState.hasProviderCredential;

  return (
    <CoworkerPage variant="workspace" width="full">
      {isProviderMissing ? (
        <Banner
          status="warning"
          title="Reviewer runs are blocked"
          description="No connected provider credential. New pull requests will queue but cannot execute."
          endContent={
            <Link href={SETUP_PROVIDER_PATH} isStandalone>
              Connect OpenAI Codex
            </Link>
          }
        />
      ) : null}
      <RunsTableClient />
    </CoworkerPage>
  );
}
