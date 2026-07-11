import { redirect } from "next/navigation";

// The workspace is now the run detail page itself (`/app/runs/[runId]`). This
// legacy route only redirects so old "Open workspace" links keep resolving.
export default async function RunWorkspaceRedirect({
  params,
}: {
  params: Promise<{ runId: string }>;
}): Promise<never> {
  const { runId } = await params;
  redirect(`/app/runs/${runId}`);
}
