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
  listGitHubIssues,
  getGitHubIssue,
  listGitHubIssueComments,
  createGitHubIssueComment,
  listOpenGitHubPullRequests,
  getGitHubPullRequest,
} = await import("./github-app");

type GitHubAppWorkerRole = typeof IMPLEMENTATION_WORKER_ROLE | typeof CODE_REVIEW_WORKER_ROLE;

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error(`Malformed JWT (expected three segments): ${jwt}`);
  }
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

  // Derive the argument types from `fetch` itself rather than naming DOM-only
  // aliases like `RequestInfo`, which aren't in this package's lib (ESNext + bun
  // types only). The `as typeof fetch` assertion supplies the `preconnect`
  // property that a bare arrow function lacks.
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
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

// noUncheckedIndexedAccess makes `captured[0]` possibly-undefined; funnel every
// read through this helper so tests both assert exactly one token request was
// minted and get a non-optional handle to it.
function takeSingleRequest(captured: CapturedRequest[]): CapturedRequest {
  expect(captured).toHaveLength(1);
  const [request] = captured;
  if (!request) {
    throw new Error("Expected exactly one captured GitHub token request.");
  }
  return request;
}

describe("per-role GitHub App token minting", () => {
  test("defaults to the reviewer app (regression: reviewer path untouched)", async () => {
    const { captured } = stubGitHubTokenEndpoint();

    const token = await createGitHubInstallationAccessToken("500100");

    expect(token).toBe("ghs_installation_token");
    const request = takeSingleRequest(captured);
    expect(request.url).toBe("https://api.github.com/app/installations/500100/access_tokens");

    const { claims } = decodeJwt(request.jwt);
    expect(claims.iss).toBe(REVIEWER_APP_ID);
    // Signed by the reviewer key, and not by the Coder key.
    expect(
      verifyJwtSignature(
        request.jwt,
        reviewerKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(true);
    expect(
      verifyJwtSignature(
        request.jwt,
        coderKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(false);
  });

  test("role=implementation mints with the Coder app identity", async () => {
    const { captured } = stubGitHubTokenEndpoint();

    await createGitHubInstallationAccessToken("500200", IMPLEMENTATION_WORKER_ROLE);

    const request = takeSingleRequest(captured);
    const { claims } = decodeJwt(request.jwt);
    expect(claims.iss).toBe(CODER_APP_ID);
    expect(
      verifyJwtSignature(
        request.jwt,
        coderKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(true);
    expect(
      verifyJwtSignature(
        request.jwt,
        reviewerKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toBe(false);
  });

  test("explicit code_review role is identical to the default", async () => {
    const { captured } = stubGitHubTokenEndpoint();

    await createGitHubInstallationAccessToken("500300", CODE_REVIEW_WORKER_ROLE);

    const { claims } = decodeJwt(takeSingleRequest(captured).jwt);
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

// Finding B (PR #50 review): the repo-scoped issue/PR helpers minted the reviewer
// JWT unconditionally, so a repository linked only through the Coder app 404s
// (its installation token can't be minted with the reviewer app). Each helper now
// threads a role; the repo-scoped procedures pass resolveGitHubAppWorkerRole of the
// installation. Stub the token + API endpoints and assert the token-mint JWT is
// signed by the installation's own app for the threaded role.
function stubGitHubApiEndpoints(): { tokenRequests: CapturedRequest[] } {
  const tokenRequests: CapturedRequest[] = [];

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/access_tokens")) {
      const authorization = new Headers(init?.headers).get("authorization") ?? "";
      tokenRequests.push({ url, jwt: authorization.replace(/^Bearer\s+/i, "") });
      return new Response(
        JSON.stringify({ token: "ghs_installation_token", permissions: { issues: "write" } }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    // Downstream API call: list endpoints carry a query string (array body); a
    // single-resource GET or a create-comment POST wants an object.
    return new Response(url.includes("?") ? "[]" : "{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { tokenRequests };
}

describe("repo-scoped GitHub helpers thread the installation's app role", () => {
  const roleThreadedHelpers: {
    name: string;
    call: (role?: GitHubAppWorkerRole) => Promise<unknown>;
  }[] = [
    { name: "listGitHubIssues", call: (role) => listGitHubIssues("700", "octo", "widgets", role) },
    { name: "getGitHubIssue", call: (role) => getGitHubIssue("700", "octo", "widgets", 3, role) },
    {
      name: "listGitHubIssueComments",
      call: (role) => listGitHubIssueComments("700", "octo", "widgets", 3, role),
    },
    {
      name: "createGitHubIssueComment",
      call: (role) => createGitHubIssueComment("700", "octo", "widgets", 3, "hi", role),
    },
    {
      name: "listOpenGitHubPullRequests",
      call: (role) => listOpenGitHubPullRequests("700", "octo", "widgets", role),
    },
    {
      name: "getGitHubPullRequest",
      call: (role) => getGitHubPullRequest("700", "octo", "widgets", 9, role),
    },
  ];

  for (const helper of roleThreadedHelpers) {
    test(`${helper.name} mints with the Coder app for the implementation role`, async () => {
      const { tokenRequests } = stubGitHubApiEndpoints();

      await helper.call(IMPLEMENTATION_WORKER_ROLE);

      const request = takeSingleRequest(tokenRequests);
      expect(decodeJwt(request.jwt).claims.iss).toBe(CODER_APP_ID);
      expect(
        verifyJwtSignature(
          request.jwt,
          coderKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
        ),
      ).toBe(true);
    });

    test(`${helper.name} defaults to the reviewer app (regression: reviewer path untouched)`, async () => {
      const { tokenRequests } = stubGitHubApiEndpoints();

      await helper.call();

      expect(decodeJwt(takeSingleRequest(tokenRequests).jwt).claims.iss).toBe(REVIEWER_APP_ID);
    });
  }
});
