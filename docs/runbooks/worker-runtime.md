# Worker Runtime Notes

The runtime model is role-based.

## Naming

- Use `workerRole` for backend behavior, durable events, sandbox labels, trigger
  rules, and tests.
- Use `workerDisplayName` only for user-defined labels in UI and external
  output.
- Do not hard-code personal names into module names, run type decisions,
  prompts, Daytona labels, or event types.

Current role:

```text
code_review
```

Default display name:

```text
Code Review Worker
```

## GitHub PR Review Flow

1. GitHub webhook admission verifies the delivery and extracts trusted
   pull-request metadata.
2. The run planner maps the admitted event to `workerRole=code_review` and
   `runType=github.pull_request_review`.
3. The worker claims queued runs for that role and run type.
4. The Daytona runner receives `workerRole` and `workerDisplayName`.
5. GitHub tools use the display name in comments/checks, while durable labels
   and events use the role.

## Adding A Role

Add a role adapter behind the worker runtime seam:

- role id, for example `implementation`
- default display name
- admitted trigger rules
- Flue instructions
- required tools
- result policy
- artifact policy
- proof script expectations

Do not create a separate bespoke webhook-to-sandbox pipeline for each role.
