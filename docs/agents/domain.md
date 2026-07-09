# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary (Organization, Worker,
  Worker Role, Run, Trigger Rule, …). Use its vocabulary in issue titles, specs,
  hypotheses, and test names.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In
  particular, `0001-worker-role-github-app-boundaries.md` governs GitHub App
  identity and per-role permission boundaries.

If any of these files don't exist, **proceed silently**. Don't flag their absence;
don't suggest creating them upfront. The `/domain-modeling` skill creates them
lazily when terms or decisions actually get resolved.

## File structure

This is a **single-context** repo: one `CONTEXT.md` + `docs/adr/` at the repo root.

```
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-worker-role-github-app-boundaries.md
├── apps/
└── packages/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids. Personal/display names (`workerDisplayName`)
are data, never module interface — see the Worker entry in `CONTEXT.md`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0001 (worker-role GitHub App boundaries) — but worth reopening because…_
