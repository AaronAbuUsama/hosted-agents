import { registerProvider } from "@flue/runtime";
import { OPENAI_CODEX_PROVIDER } from "@hosted-agents/api/codex-model-policy";
import { getOAuthApiKey, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type PiAuthFile = Record<string, OAuthCredentials>;

function getPiAuthFilePath() {
  return process.env.PI_AUTH_FILE ?? join(homedir(), ".pi", "agent", "auth.json");
}

async function readPiAuthFile(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PiAuthFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function registerPiOpenAICodexProvider() {
  const authFilePath = getPiAuthFilePath();
  const credentials = await readPiAuthFile(authFilePath);

  if (!credentials?.[OPENAI_CODEX_PROVIDER]) {
    console.warn(
      `[pi-auth] No ${OPENAI_CODEX_PROVIDER} credential found at ${authFilePath}. Run pi login for OpenAI Codex or set PI_AUTH_FILE.`,
    );
    return;
  }

  const result = await getOAuthApiKey(OPENAI_CODEX_PROVIDER, credentials);

  if (!result) {
    console.warn(`[pi-auth] Unable to resolve ${OPENAI_CODEX_PROVIDER} OAuth credentials.`);
    return;
  }

  const nextCredentials = {
    ...credentials,
    [OPENAI_CODEX_PROVIDER]: result.newCredentials,
  };

  if (JSON.stringify(nextCredentials) !== JSON.stringify(credentials)) {
    await mkdir(dirname(authFilePath), { recursive: true });
    await writeFile(authFilePath, `${JSON.stringify(nextCredentials, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  // Provider registration carries transport only; the model + reasoning-effort
  // policy (default `gpt-5.5` at "minimal"/lowest) is applied by each agent that
  // uses this provider — see codex-model-policy.ts and agents/code-review.ts.
  registerProvider(OPENAI_CODEX_PROVIDER, {
    apiKey: result.apiKey,
  });

  console.info(`[pi-auth] Registered ${OPENAI_CODEX_PROVIDER} provider from Pi OAuth credentials.`);
}
