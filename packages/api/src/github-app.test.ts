import { describe, expect, test, afterEach } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";

import {
  CODE_REVIEW_WORKER_ROLE,
  IMPLEMENTATION_WORKER_ROLE,
} from "@hosted-agents/db/schema/agent-runs";

// github-app reads env (and creates the db singleton) at module load, so install
// hermetic environment variables before importing it. Two distinct GitHub App
// identities are configured: the reviewer app (default) and the Coder app.
process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";

const reviewerKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const coderKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

const REVIEWER_APP_ID = "111111";
const REVIEWER_APP_SLUG = "reviewer-app";
const CODER_APP_ID = "222222";
const CODER_APP_SLUG = "coder-app";

process.env.GITHUB_APP_ID = REVIEWER_APP_ID;
process.env.GITHUB_APP_SLUG = REVIEWER_APP_SLUG;
process.env.GITHUB_APP_PRIVATE_KEY = reviewerKeyPair.privateKey
  .export({ type: "pkcs1", format: "pem" })
  .toString();
process.env.GITHUB_CODER_APP_ID = CODER_APP_ID;
process.env.GITHUB_CODER_APP_SLUG = CODER_APP_SLUG;
process.env.GITHUB_CODER_APP_PRIVATE_KEY = coderKeyPair.privateKey
  .export({ type: "pkcs1", format: "pem" })
  .toString();

const {
  createGitHubInstallationAccessToken,
  createGitHubAppInstallUrl,
  getGitHubAppSlug,
  isGitHubAppConfigured,
  resolveGitHubAppWorkerRole,
} = await import("./github-app");

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  return {
    header,
    payload,
    signature,
    claims: JSON.parse(base64UrlToBuffer(payload).toString("utf8")) as { iss: string },
  };
}

function verifyJwtSignature(jwt: string, publicKeyPem: string): boolean {
  const { header, payload, signature } = decodeJwt(jwt);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  return verifier.verify(publicKeyPem, base64UrlToBuffer(signature));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type CapturedRequest = { url: string; jwt: string };

function stubGitHubTokenEndpoint(): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    captured.push({
      url: typeof input === "string" ? input : input.toString(),
      jwt: authorization.replace(/^Bearer\s+/i, ""),
    });

    return new Response(JSON.stringify({ token: "ghs_installation_token" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { captured };
}

describe("per-role GitHub App token minting", () => {
  test("defaults to the reviewer app (regression: reviewer path untouched)", async () => {
    const { captured } = stubGitHubTokenEndpoint();

    const token = await createGitHubInstallationAccessToken("500100");

    expect(token).toBe("ghs_installation_token");
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.github.com/app/installations/500100/access_tokens");

    const { claims } = decodeJwt(captured[0].jwt);
    expect(claims.iss).toBe(REVIEWER_APP_ID);
    // Signed by the reviewer key, and not by the Coder key.
    expect(
      verifyJwtSignature(
        captured[0].jwt,
        reviewerKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(true);
    expect(
      verifyJwtSignature(
        captured[0].jwt,
        coderKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(false);
  });

  test("role=implementation mints with the Coder app identity", async () => {
    const { captured } = stubGitHubTokenEndpoint();

    await createGitHubInstallationAccessToken("500200", IMPLEMENTATION_WORKER_ROLE);

    expect(captured).toHaveLength(1);
    const { claims } = decodeJwt(captured[0].jwt);
    expect(claims.iss).toBe(CODER_APP_ID);
    expect(
      verifyJwtSignature(
        captured[0].jwt,
        coderKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(true);
    expect(
      verifyJwtSignature(
        captured[0].jwt,
        reviewerKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(false);
  });

  test("explicit code_review role is identical to the default", async () => {
    const { captured } = stubGitHubTokenEndpoint();

    await createGitHubInstallationAccessToken("500300", CODE_REVIEW_WORKER_ROLE);

    const { claims } = decodeJwt(captured[0].jwt);
    expect(claims.iss).toBe(REVIEWER_APP_ID);
  });
});

describe("GitHub App identity helpers", () => {
  test("install urls target the app slug for the requested role", () => {
    expect(createGitHubAppInstallUrl("org-1")).toBe(
      `https://github.com/apps/${REVIEWER_APP_SLUG}/installations/new?state=org-1`,
    );
    expect(createGitHubAppInstallUrl("org-1", IMPLEMENTATION_WORKER_ROLE)).toBe(
      `https://github.com/apps/${CODER_APP_SLUG}/installations/new?state=org-1`,
    );
  });

  test("both apps report configured and expose their slug", () => {
    expect(isGitHubAppConfigured()).toBe(true);
    expect(isGitHubAppConfigured(IMPLEMENTATION_WORKER_ROLE)).toBe(true);
    expect(getGitHubAppSlug()).toBe(REVIEWER_APP_SLUG);
    expect(getGitHubAppSlug(IMPLEMENTATION_WORKER_ROLE)).toBe(CODER_APP_SLUG);
  });

  test("resolveGitHubAppWorkerRole maps an installation's app slug to its role", () => {
    expect(resolveGitHubAppWorkerRole(CODER_APP_SLUG)).toBe(IMPLEMENTATION_WORKER_ROLE);
    expect(resolveGitHubAppWorkerRole(REVIEWER_APP_SLUG)).toBe(CODE_REVIEW_WORKER_ROLE);
    // Unknown or missing slugs fall back to the reviewer role so existing
    // reviewer installations keep triggering reviews.
    expect(resolveGitHubAppWorkerRole("some-other-app")).toBe(CODE_REVIEW_WORKER_ROLE);
    expect(resolveGitHubAppWorkerRole(null)).toBe(CODE_REVIEW_WORKER_ROLE);
  });
});
