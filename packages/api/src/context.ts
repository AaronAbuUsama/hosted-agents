import { auth } from "@hosted-agents/auth";
import type { Context as HonoContext } from "hono";

export type ReviewRunInvocationInput = {
  reviewRunId: string;
  repositoryUrl?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch: string;
  baseBranch?: string;
  reviewContext?: string;
  providerCredentialId?: string;
};

export type ReviewRunInvocationReceipt = {
  flueRunId: string;
};

export type ReviewRunInvoker = (
  input: ReviewRunInvocationInput,
) => Promise<ReviewRunInvocationReceipt>;

export type CreateContextOptions = {
  context: HonoContext;
  reviewRunInvoker?: ReviewRunInvoker;
};

const missingReviewRunInvoker: ReviewRunInvoker = async () => {
  throw new Error("Review-run invoker is not configured for this server context.");
};

export async function createContext({
  context,
  reviewRunInvoker = missingReviewRunInvoker,
}: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    auth: null,
    session,
    reviewRunInvoker,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
