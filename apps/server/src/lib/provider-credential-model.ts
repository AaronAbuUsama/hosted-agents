import {
  decryptJsonCredential,
  encryptJsonCredential,
} from "@hosted-agents/api/provider-credential-crypto";
import {
  DEFAULT_CODEX_MODEL_ID,
  OPENAI_CODEX_PROVIDER,
  resolveReasoningEffort,
  type ReasoningEffort,
} from "@hosted-agents/api/codex-model-policy";
import { db } from "@hosted-agents/db";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";
import { registerProvider } from "@flue/runtime";
import { getOAuthApiKey, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { eq } from "drizzle-orm";

const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export type OpenAICodexModelRegistration = {
  // Flue model specifier: `<credentialProviderId>/<modelId>`.
  model: string;
  // Reasoning effort to apply as the agent's thinkingLevel for this run.
  reasoningEffort: ReasoningEffort;
};

function toCredentialProviderId(credentialId: string) {
  return `openai-codex-credential-${credentialId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

// Registers a per-credential Codex provider and resolves the model + reasoning
// policy for a run. `registerProvider` carries no reasoning field (effort is a
// per-agent/per-call option in Flue), so the resolved effort is returned here
// for the runner to apply as the agent's thinkingLevel.
export async function registerOpenAICodexCredentialModel(
  credentialId: string,
  options: { modelId?: string | null; reasoningEffort?: string | null } = {},
): Promise<OpenAICodexModelRegistration> {
  const modelId = options.modelId?.trim() || DEFAULT_CODEX_MODEL_ID;
  const [row] = await db
    .select()
    .from(agentProviderCredential)
    .where(eq(agentProviderCredential.id, credentialId))
    .limit(1);

  if (!row || row.provider !== OPENAI_CODEX_PROVIDER || row.status !== "connected") {
    throw new Error("Connected OpenAI Codex credential was not found.");
  }

  const credentials = decryptJsonCredential<OAuthCredentials>(row.encryptedCredential);
  const result = await getOAuthApiKey(OPENAI_CODEX_PROVIDER, {
    [OPENAI_CODEX_PROVIDER]: credentials,
  });

  if (!result) {
    throw new Error("OpenAI Codex credential could not be resolved.");
  }

  const nextEncryptedCredential = encryptJsonCredential(result.newCredentials);
  await db
    .update(agentProviderCredential)
    .set({
      encryptedCredential: nextEncryptedCredential,
      expiresAt: new Date(result.newCredentials.expires),
      lastError: null,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentProviderCredential.id, credentialId));

  const providerId = toCredentialProviderId(credentialId);
  registerProvider(providerId, {
    api: "openai-codex-responses",
    baseUrl: OPENAI_CODEX_BASE_URL,
    apiKey: result.apiKey,
    contextWindow: 272000,
    maxTokens: 128000,
  });

  return {
    model: `${providerId}/${modelId}`,
    reasoningEffort: resolveReasoningEffort(options.reasoningEffort),
  };
}
