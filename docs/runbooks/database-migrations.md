# Database Migrations

The application database is managed with Drizzle migrations in `packages/db/src/migrations`.

## Commands

- Generate a durable migration after schema changes:

  ```bash
  bun run db:generate
  ```

- Apply committed migrations to any durable environment:

  ```bash
  bun run db:migrate
  ```

- Push schema directly only for disposable local databases:

  ```bash
  bun run db:push
  ```

`db:push` is a local development shortcut. Do not use it as the Dokploy or production schema deployment path because it bypasses the checked-in migration history.

## Dokploy / Docker deploy path

The server image runs migrations before starting the Hono service:

```text
cd /app && bun run db:migrate && cd /app/apps/server && bun run start
```

For Dokploy setups that support a separate release command, use the same migration command as the release step and start the service only after it succeeds:

```bash
bun run db:migrate
```

Do not run untrusted repository commands in the service container. Database migrations are trusted application deployment work; agent execution and repository commands still belong in Daytona sandboxes through Flue.

## Legacy databases from before migrations

This repository originally used `db:push` without committed migration files. `bun run db:migrate` handles that transition:

1. If the Drizzle migration table exists, it applies unapplied Drizzle migrations normally.
2. If no migration history exists and the database already has application tables, it safely adopts the generated baseline without dropping existing tables.
3. During the migration command it ensures the Slice 1 webhook and sandbox execution schema exists:
   - `github_webhook_delivery`
   - GitHub delivery, installation, repository, and pull request metadata columns on `review_run`
   - sandbox provider/id, timing, artifacts, and execution log columns on `review_run`
   - indexes used by webhook admission and review-run lookups
4. It records the baseline migration in `__drizzle_migrations`, so later schema changes use normal Drizzle migrations.

Back up production data before the first migration run against a legacy database. If adoption fails, stop the deploy and inspect the database shape before starting the new service image.

## Slice 1 migration proof

The checked-in baseline migration was generated from the current Drizzle schema and includes:

- existing Better Auth, organization, credential, GitHub installation, repository, and review tables
- `github_webhook_delivery`
- GitHub PR metadata columns and indexes on `review_run`
- sandbox execution metadata columns and `review_run_sandboxId_idx`

Validation commands used for this slice:

```bash
DATABASE_URL=file:/tmp/hosted-agents-fresh-migrate.sqlite bun run db:migrate
DATABASE_URL=file:/tmp/hosted-agents-legacy-migrate.sqlite bun run db:migrate
```

The fresh check proves an empty database can be built from migrations. The legacy check proves a database with a pre-Slice-1 `review_run` table is adopted without losing existing rows and gains the webhook admission columns.
