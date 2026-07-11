// Reviewer-vs-Coder classification for linked GitHub installations, in one place.
//
// Two GitHub Apps can be linked to the same Coworker organization: the reviewer
// app (worker role `code_review`, and the default for every legacy install) and
// the Coder app (worker role `implementation`). The server tags each installation
// with `workerRole` in the `githubInstallations` procedure — resolved from env
// config, never gated on the caller's org role — so the client can tell the two
// apart without the admin-only Coder install-config call.
//
// This matters because both apps see the same underlying repositories, so a repo
// shows up once per installation. Every reviewer/issue surface (request-review,
// the issues board workspace, repository settings, the sidebar) reads GitHub with
// a `code_review` installation token; that token is rejected with a 404 against a
// Coder installation id. Those surfaces must therefore offer reviewer-installation
// repositories only. The Coder installation is surfaced solely by the onboarding
// flow, which handles it explicitly.

// Kept in sync with IMPLEMENTATION_WORKER_ROLE in
// packages/db/src/schema/agent-runs.ts. Duplicated as a bare string literal so
// this browser-safe module never pulls the db/drizzle runtime into the client
// bundle.
export const IMPLEMENTATION_WORKER_ROLE = "implementation";

type InstallationWorkerRole = { readonly workerRole: string };

// The Coder app installation (opens implementation pull requests under its own
// identity). Its repositories must be kept out of reviewer/issue surfaces.
export function isCoderInstallation(installation: InstallationWorkerRole): boolean {
  return installation.workerRole === IMPLEMENTATION_WORKER_ROLE;
}

// The reviewer app installation (or any legacy install, which defaults to the
// code_review role). Safe to read from and select on every reviewer surface.
export function isReviewerInstallation(installation: InstallationWorkerRole): boolean {
  return !isCoderInstallation(installation);
}
