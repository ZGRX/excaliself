---
title: Recover admin access
description: What to do when no admin can sign in, for example when the only admin lost their password.
---

The normal way to recover a lost password is an admin-generated reset link
(Settings → Members → Generate reset link). This recipe is for the case where
that path is gone: **no admin can sign in** — typically the instance's only
admin lost their password.

Recovery operates directly on the database. There is deliberately no UI for
this: anyone with shell access to the server already owns the instance, and a
web-reachable recovery surface would only weaken it.

Both recipes below assume the stock [Docker Compose](/docs/docker-compose/) deployment.
If you deploy differently (e.g. a managed Postgres or a PaaS like Coolify),
the SQL is identical — just open `psql` against whatever database your
`DATABASE_URL` points at.

## Open a database shell

From the directory containing `docker-compose.yaml`:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

This uses the credentials already present inside the `db` container, so it
works regardless of what you set `POSTGRES_USER` / `POSTGRES_DB` to.

List the accounts to find the one you're recovering (column names are
camelCase, so they must be double-quoted in SQL; table names are lowercase):

```sql
SELECT id, email, role FROM users;
```

## Promote an existing member to admin

If anyone else on the instance can still sign in, make them an admin — they
can then issue a normal reset link for the locked-out account:

```sql
UPDATE users SET role = 'admin', "updatedAt" = now()
WHERE email = 'member@example.com';
```

Server-side admin checks read the role fresh on every request, so the
promotion is effective immediately. The member's UI may not show the
admin-only surfaces until their cached session refreshes (up to 5 minutes) —
signing out and back in picks it up instantly.

## Reset the sole admin's own password

If there is no other account to promote, generate a password-reset token
directly in the database, then finish through the app's normal reset page.
The app hashes the new password with better-auth's own hasher, so nothing
hand-rolled ever touches the credential row.

In the `psql` shell (substitute the admin's email):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The schema allows at most one pending reset per user; clear any leftover.
DELETE FROM password_resets
WHERE "usedAt" IS NULL
  AND "userId" = (SELECT id FROM users WHERE email = 'admin@example.com');

INSERT INTO password_resets (id, token, "userId", "expiresAt", "createdAt")
SELECT gen_random_uuid()::text,
       encode(gen_random_bytes(32), 'hex'),
       id,
       now() + interval '24 hours',
       now()
FROM users
WHERE email = 'admin@example.com'
RETURNING token;
```

The `INSERT` prints the generated token:

```
                              token
------------------------------------------------------------------
 4f1f4ff26f8e6cbd6cb557b8a0d6a4c9…
(1 row)
```

If it prints `(0 rows)` instead, the email didn't match any user — check
`SELECT email FROM users;` and retry.

Now open the reset page in a browser, substituting your instance's URL and
the token:

```
https://your-instance.example.com/reset-password?token=<token>
```

Set a new password. You'll be signed in immediately; every other session for
that account is revoked, and drawings open in those sessions stop getting live
edits. The token is single-use (it also expires after 24 hours).

## Notes

- `CREATE EXTENSION pgcrypto` requires superuser. The Compose setup's
  `POSTGRES_USER` is the cluster superuser, so this just works; on a managed
  Postgres where it doesn't, replace `gen_random_bytes(32)` with any unique
  string of your own — the token's only requirements are uniqueness and
  unguessability.
- The reset flow only rewrites the password credential and sessions. Drawings,
  folders, invites, and other members are untouched.
