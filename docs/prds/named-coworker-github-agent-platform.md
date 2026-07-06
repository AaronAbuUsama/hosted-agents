# PRD: Named Coworker GitHub Agent Platform

Status: Draft
Date: 2026-07-05

## 2026-07-06 Vocabulary Update

The runtime model is now role-based. Personal or branded names are
user-defined display data, not backend module identity.

- Use `workerRole` for stable capability ids such as `code_review`.
- Use `workerDisplayName` for user-defined product and external-output labels.
- Do not hard-code personal names into trigger rules, durable events, sandbox
  labels, runtime modules, or run type decisions.
- The first runtime role is `code_review`; the default display name is
  `Code Review Worker`.

This update supersedes the earlier names-first language below. The older
sections remain as historical planning context until the PRD is recut.

## Problem Statement

The current product has proven that a user can sign in, create an organization, connect an OpenAI Codex credential, and run a code review agent from the dashboard. That is useful proof, but it is still shaped like a one-off review console.

The product we actually need is a hosted coworker platform for GitHub. Customers should not think they are enabling generic technical agents. They should feel like they are hiring named coworkers from coworker.tech who participate in their GitHub workflow with clear roles, identities, permissions, and accountability.

The first named coworker is Abu Bakr, a Code Review Engineer. Abu Bakr should review pull requests, leave inline comments and suggestions, produce a review summary, and optionally block merge through a required GitHub check. Later named coworkers, such as Umar, should be able to do implementation work, create branches, open pull requests, and respond to review feedback.

The platform also needs a hard runtime boundary. Untrusted repository code must not run inside the Hono server process. Every GitHub-triggered agent run needs a sandbox with scoped credentials, scoped repository access, durable run records, and visible logs/artifacts.

The platform also needs first-class observability before the GitHub runtime gets deep. Every run should be inspectable in three layers: product state in the application database, operational failures in Sentry, and full agent/model traces in Braintrust. Sentry is for actionable application and workflow failures. Braintrust is for content-bearing agent traces, spans, model calls, tool calls, token usage, and evaluation-oriented debugging.

## Solution

Build a generic named-coworker runtime that sits behind the existing Hono server, Better Auth organization model, OpenAI Codex credential storage, and Flue agent execution.

Users will create or select a Coworker organization, connect their Codex/OpenAI credentials, and install named coworkers into their GitHub organization or selected repositories. Each named coworker maps to a product identity and, where distinct GitHub author identity is required, a distinct GitHub App.

The initial production slice should focus on Abu Bakr:

- Product identity: Abu Bakr
- Role: Code Review Engineer
- Email: abu-bakr@coworker.tech
- GitHub App display name: Abu Bakr by Coworker
- Primary workflow: review pull requests and report pass/fail status

The backend will receive GitHub webhooks for Abu Bakr, verify signatures, resolve the GitHub installation to a Coworker organization, match repository and branch trigger rules, create an agent run, and enqueue work for a sandbox worker. The sandbox worker will fetch the relevant pull request source/diff, run Abu Bakr with the correct organization-scoped Codex credential, and post the results back to GitHub as Abu Bakr.

The current dashboard can remain visually rough for this implementation track. It only needs enough UI to manage organization connection state, provider credentials, named coworker installation state, trigger rules, and run visibility. A separate worktree can own the polished information architecture and product UI.

Telemetry setup is part of the foundation. Before the first real Abu Bakr GitHub run, the server and worker entrypoints should initialize Sentry and Braintrust conditionally from environment variables, register Flue observers, attach run correlation metadata, and prove that a single run can be found across the database, Flue run history, Sentry, and Braintrust.

## User Stories

1. As a customer, I want to create a Coworker organization, so that my team has a shared place to configure named coworkers.
2. As a customer, I want to connect my Codex/OpenAI credential to my Coworker organization, so that the coworkers run using my subscribed model access.
3. As a customer, I want my Codex/OpenAI credential encrypted at rest, so that my provider secrets are not stored in plaintext.
4. As a customer, I want to install Abu Bakr into my GitHub organization, so that he can review pull requests in selected repositories.
5. As a customer, I want Abu Bakr to appear as Abu Bakr in GitHub, so that reviewers know which coworker produced the review.
6. As a customer, I want each named coworker to have a role, so that my team understands what each coworker is responsible for.
7. As a customer, I want to select which repositories Abu Bakr can access, so that his permissions are scoped to the right codebases.
8. As a customer, I want to configure branch wildcard rules, so that Abu Bakr runs only on the branches where I want automated review.
9. As a customer, I want to configure pull request event triggers, so that Abu Bakr runs when a PR is opened, updated, reopened, or marked ready for review.
10. As a customer, I want to disable Abu Bakr for draft pull requests, so that early work is not reviewed too soon.
11. As a customer, I want to enable Abu Bakr for draft pull requests when desired, so that teams with early review habits can use him earlier.
12. As a customer, I want Abu Bakr to post a GitHub check, so that the review result is visible in the PR checks area.
13. As a customer, I want Abu Bakr's check to be optionally blocking, so that high-severity findings can prevent unsafe merges.
14. As a customer, I want to configure severity thresholds for blocking, so that I can tune merge policy to my team's risk tolerance.
15. As a developer, I want Abu Bakr to leave inline comments on specific changed lines, so that feedback appears where the code needs attention.
16. As a developer, I want Abu Bakr to suggest code changes where possible, so that I can apply straightforward fixes quickly.
17. As a developer, I want Abu Bakr to post a concise review summary, so that I can understand the overall result without reading every detail first.
18. As a developer, I want Abu Bakr to avoid duplicate comments on repeated synchronize events, so that PRs do not become noisy.
19. As a developer, I want Abu Bakr to update or supersede previous review output, so that the latest review state is clear.
20. As a developer, I want Abu Bakr to explain blocking findings, so that I know what must be fixed before merge.
21. As a team admin, I want to see all Abu Bakr runs in the Coworker dashboard, so that I can audit what happened.
22. As a team admin, I want to inspect a run's GitHub event, repository, branch, PR, status, findings, and timestamps, so that I can diagnose failures.
23. As a team admin, I want to see sandbox status and logs for a run, so that I can distinguish GitHub, sandbox, model, and application failures.
24. As a team admin, I want to see which provider credential was used by a run without exposing the secret, so that I can audit account usage safely.
25. As a platform operator, I want each run to have a durable event log, so that failures can be replayed or diagnosed after the process exits.
26. As a platform operator, I want GitHub webhooks to be idempotent, so that retries do not create duplicate runs or duplicate comments.
27. As a platform operator, I want sandbox execution to be isolated from the Hono server, so that untrusted repository code cannot compromise the control plane.
28. As a platform operator, I want repository commands to run without provider credentials in their environment, so that untrusted build/test code cannot steal model tokens.
29. As a platform operator, I want GitHub installation tokens to be short-lived and scoped, so that repository access is limited.
30. As a platform operator, I want named coworker configuration to be data-driven, so that Umar and later coworkers reuse the same runtime spine.
31. As a customer, I want to install Umar later as a Software Engineer coworker, so that he can implement issues and open pull requests.
32. As a customer, I want Umar to have a distinct GitHub identity from Abu Bakr, so that implementation work and review work are clearly separated.
33. As a customer, I want different coworkers to have different GitHub permissions, so that Abu Bakr can review while Umar can write code.
34. As a customer, I want the dashboard hidden until I belong to an organization, so that organization-scoped resources are not shown without context.
35. As a customer, I want GitHub login/linking to be separate from GitHub App installation, so that human identity and repository access are handled correctly.
36. As a customer, I want GitHub organization linkage to map to my Coworker organization, so that installations and billing are scoped to the right tenant.
37. As a developer, I want Abu Bakr to respect repository-specific rules, so that different teams or repositories can use different review policies.
38. As a developer, I want Abu Bakr to fail gracefully when GitHub comments cannot be anchored, so that the review still posts useful summary feedback.
39. As a platform operator, I want a clear path from webhook to run to sandbox to GitHub result, so that every state transition has an owner.
40. As a platform operator, I want the first implementation to remain compatible with the rough UI, so that backend progress is not blocked by the parallel UI/IA worktree.

## Implementation Decisions

- Model named coworkers as first-class product entities. Abu Bakr and Umar are user-facing identities. Internal technical agent types can still exist, but they should not be the primary user-facing abstraction.
- Use one GitHub App per named coworker when distinct GitHub author identity is required. Abu Bakr should have his own GitHub App identity. Umar should have a separate GitHub App identity when he is introduced.
- Keep GitHub OAuth login/linking separate from GitHub App installation. OAuth identifies the human user. GitHub App installation grants repository access to a named coworker.
- Store GitHub App configuration per named coworker, including app id, private key reference, webhook secret reference, installation callback state, and the public install URL.
- Store GitHub installations linked to Coworker organizations. A GitHub installation should resolve to the customer organization, GitHub account/org, selected repositories, and the named coworker that owns the app.
- Store repository records derived from GitHub installation data. Repository records should include owner, name, provider id, default branch, visibility metadata where available, and whether the repo is currently active for a coworker.
- Store agent installation records that connect a Coworker organization, named coworker, GitHub installation, and repository scope.
- Store trigger rules separately from named coworker definitions. Trigger rules should describe event type, action set, repository scope, branch patterns, draft behavior, and blocking policy.
- Introduce a generic agent run boundary. Code review should become one run type under the named coworker runtime, not the only runtime model.
- Preserve review-specific data as run output or run artifacts. The generic run should own identity, trigger, status, sandbox, credential, and source event metadata.
- Add run events as an append-only timeline. Use them for webhook received, trigger matched, queued, sandbox started, model call started, GitHub post attempted, completed, and failed transitions.
- Add run artifacts for durable outputs. Artifacts should store review summaries, findings, normalized GitHub posting payloads, logs, and any future patch output from implementation coworkers.
- Add a sandbox runner interface. The control plane should enqueue a run and receive status/results. It should not clone repositories or execute repository commands itself.
- Start with an application-owned Daytona sandbox per run. Each run gets a fresh managed Linux workspace, scoped secrets, provider-owned lifecycle controls, and cleanup behavior. Docker remains only the deployment packaging for the Hono/web service on Dokploy; agent execution must not run inside that service container.
- Separate agent/model credentials from repository command execution. The agent runtime may use the organization-scoped Codex credential, but untrusted repo commands should not receive model credentials or long-lived GitHub credentials in their environment.
- Use short-lived GitHub installation tokens for repository fetch and GitHub posting. Tokens should be minted per run and scoped to the named coworker's installation.
- The sandbox should receive only the minimal data needed for the run: repository identity, pull request refs, installation token, model credential handle or resolved ephemeral auth, and run id.
- The first Abu Bakr path should run on pull request webhooks: opened, reopened, synchronize, and ready_for_review.
- Abu Bakr should create or update a GitHub check named for the coworker and role, such as "Abu Bakr / Code Review".
- Blocking behavior should be implemented through GitHub checks and branch protection, not only through comment text.
- Abu Bakr should post PR review comments where line anchors are available. If inline anchoring fails, he should fall back to a top-level PR review summary or comment.
- Abu Bakr should avoid duplicate comments by tying GitHub output to run ids, commit SHAs, previous check runs, and prior Coworker-generated comments.
- The current manual review flow can remain as a development fallback, but GitHub-triggered sandboxed runs are the product path.
- The rough dashboard should expose only enough logic controls for this track: organization selection, provider credential status, coworker installation state, trigger rules, and run list/detail.
- The polished UI/IA can be implemented in a separate worktree against the same concepts and API contracts.
- Keep the existing organization-scoped OpenAI Codex credential track. Future runs should require an organization credential in production unless an explicit system fallback is configured for local development.
- Keep the Hono server as the control plane. It should own auth, webhooks, validation, DB writes, and enqueueing work.
- Keep Flue agent execution inside the worker/sandbox side of the system, not directly in request handlers.
- Add Sentry as the operational error surface. Sentry should capture failed workflow runs and explicit error logs with run correlation fields, without exporting arbitrary prompts, model messages, tool arguments, or repository content by default.
- Add Braintrust as the agent trace surface. Braintrust should receive full Flue traces for workflow runs, model turns, tool calls, delegated tasks, usage, cost, errors, and run correlation metadata.
- Add an application-owned masking policy before enabling Braintrust in production. Braintrust traces are content-bearing, so secrets, provider credentials, GitHub tokens, and unnecessary personal data must be redacted or excluded.
- Add correlation ids consistently across product DB events, Flue logs, Sentry captures, and Braintrust traces. At minimum, include Coworker organization id, named coworker id, agent run id, Flue run id, GitHub installation id, repository id, pull request number, and sandbox id where available.
- Treat Sentry and Braintrust as observers, not the product source of truth. The application database remains authoritative for run state and user-facing history.
- Build Abu Bakr first. Add Umar only after the named coworker registry, GitHub installation mapping, generic run model, sandbox runner, and Abu Bakr webhook path are proven.

## Testing Decisions

- Tests should focus on external behavior and state transitions, not private implementation details.
- Add unit tests for trigger matching. Given a GitHub event, repository, branch, PR state, and trigger rules, the matcher should return whether a run should be created and which policy applies.
- Add unit tests for named coworker resolution. Given a webhook source and GitHub installation id, the resolver should identify the correct Coworker organization and named coworker.
- Add unit tests for credential selection. Given an organization and run request, the system should select the correct connected provider credential and never expose encrypted credential material through API responses.
- Add unit tests for webhook idempotency. Duplicate GitHub delivery ids or duplicate event payloads should not create duplicate active runs.
- Add unit tests for blocking policy. Findings at different severities should map to pass, neutral, or fail check conclusions according to configured thresholds.
- Add integration tests for GitHub webhook ingestion. The server should verify signatures, reject invalid payloads, resolve installations, and create queued runs.
- Add integration tests for run lifecycle. A queued run should transition through running to completed or failed with append-only run events.
- Add integration tests for sandbox runner contract using a fake runner. The Hono/API layer should not need a real Daytona sandbox to prove enqueue and callback behavior.
- Add a real local smoke test for the Daytona sandbox runner once Daytona wiring exists. The smoke should prove a run gets a fresh workspace and cannot read control-plane secrets.
- Add a browser smoke test for the rough dashboard. It should prove no-org gating, connected provider visibility, named coworker installation visibility, and run list/detail visibility.
- Add regression coverage for the existing self-review or unanchored-comment fallback behavior. GitHub can reject some review actions, and the workflow must still produce useful output.
- Add Sentry verification. Trigger one failed workflow and one explicit error log, then confirm the Sentry event has the expected run correlation fields and no prompt/model/repository content beyond the explicit error context.
- Add Braintrust verification. Run a workflow with at least one model turn and one tool/sandbox step, then confirm the trace hierarchy, closed spans, usage metrics, cost metadata, and run correlation fields.
- Add masking verification. Test representative prompts, tool values, errors, repository metadata, GitHub tokens, and provider credentials against the Braintrust masking policy before enabling production export.
- Build checks should continue to include formatting, TypeScript, server build, and web build.

## Out of Scope

- Polished product UI and information architecture. Another worktree will own the nice UI.
- Full Umar implementation workflow. Umar should be modeled now but implemented after Abu Bakr is proven.
- Billing, metering, and usage limits beyond recording enough run/provider metadata to support them later.
- Enterprise SSO.
- Multi-provider model marketplaces. The first production path uses organization-scoped OpenAI Codex credentials.
- Production-grade telemetry analytics dashboards. This PRD requires correct trace/error capture and correlation, not a polished analytics product.
- Non-GitHub providers such as GitLab or Bitbucket.
- Long-running autonomous project planning. This PRD covers GitHub-triggered coworker runs, starting with PR review.
- Human approval workflows for every action. Abu Bakr's first path can post reviews/checks according to configured policy.
- Perfect deduplication for every historic GitHub comment shape. The first version should dedupe Coworker-owned output created by this system.

## Further Notes

The implementation should proceed in vertical slices:

1. Add the named coworker registry and seed Abu Bakr.
2. Add the telemetry foundation: Sentry, Braintrust, Flue observer wiring, correlation ids, and masking policy.
3. Add GitHub App configuration and installation mapping for Abu Bakr.
4. Add generic agent run, run event, run artifact, and sandbox state records.
5. Add trigger rule matching for pull request events and branch wildcards.
6. Add the Abu Bakr webhook endpoint and signature verification.
7. Add the sandbox runner interface with a fake runner for tests.
8. Add the Daytona sandbox runner for local proof.
9. Move Abu Bakr review execution into the sandbox-backed worker path.
10. Add GitHub check run posting and PR review/comment posting.
11. Prove a real GitHub PR review end to end.
12. Add enough rough dashboard controls to inspect installations, rules, and runs.
13. Prepare Umar as the next named coworker on the same runtime spine.

Definition of done for the Abu Bakr slice:

- A customer organization can connect an OpenAI Codex credential.
- Abu Bakr can be installed into a GitHub repository through his GitHub App.
- A pull request event creates exactly one queued run for the matching trigger.
- The run executes in a sandbox, not in the Hono request process.
- The sandbox uses scoped GitHub access and the organization's Codex credential.
- The run is visible in Braintrust with spans for workflow, model turns, tool/sandbox activity, usage, cost, and correlation metadata.
- Failed workflow/error paths appear in Sentry with run correlation metadata and without unapproved content export.
- Abu Bakr posts a GitHub check and review output under his named identity.
- High-severity findings can fail the GitHub check.
- The dashboard shows the run, status, summary, findings, sandbox state, and GitHub output references.
- Formatting, type checks, server build, web build, and the new tests pass.
