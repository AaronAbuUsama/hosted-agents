# Hosted Agents Context

## Worker

A worker is a configured automation capability that can run on behalf of an
organization.

Workers have two separate names:

- `workerRole`: stable capability identity used by backend modules, trigger
  rules, runtime adapters, durable events, and tests.
- `workerDisplayName`: user-defined display label used in product surfaces and
  external output when a named identity is desired.

Personal names must not be hard-coded into runtime module names, durable event
types, sandbox labels, trigger rules, or run type decisions. A named identity is
data, not the module interface.

## Worker Role

A worker role describes what the worker does. Current roles:

- `code_review`: reviews GitHub pull requests, submits review output, and
  completes a GitHub check.

Future roles should be added as role adapters behind the worker runtime seam,
not as separate bespoke pipelines.

## Run

A run is one durable execution of a worker role. Runs are recorded in
`agent_run` with ordered `agent_run_event` rows, sandbox records, and artifacts.

## Trigger Rule

A trigger rule maps an admitted source event, such as a GitHub pull request
webhook, to a worker role and run type.
