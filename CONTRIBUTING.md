# Contributing

Thanks for your interest. Excaliself is a small project run in spare time, so
there is no promise of support or reviews. Forks are welcome.

## Setup

See [Local development](./README.md#local-development) in the README. To work
without Postgres, run `pnpm dev:preview` and open `/preview/login`.

## Checks

Run these before you open a pull request:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

The tests need Node 22.

## Pull requests

- Keep each pull request small and about one thing.
- Say what changes for a user, and how you tested it. Add a screenshot for UI
  changes.
- Add or update tests when you change behavior.
- If a user or self-hoster sees the change (a feature, a setting, an env var, a
  limit), update the docs in `landing/src/content/docs/` in the same pull
  request.
- After a schema change, run `pnpm db:generate` and commit the migration.
- For a large change, open an issue first, so we can agree on the approach
  before you spend time on it.
