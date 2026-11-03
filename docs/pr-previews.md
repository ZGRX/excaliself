# PR previews

Each pull request can get its own throwaway instance on Coolify, for example
`https://42.draw.example.com` for PR 42. It is the normal app with
`PREVIEW_MODE=true`:

- The database is an in-memory PGlite, migrated and seeded at boot. It never
  connects to `DATABASE_URL`. Data is lost when the container restarts.
- The seed is an admin (`admin@example.com` / `preview-password`) with example
  folders and drawings in Private and Team. The instance is already past
  `/setup`.
- `/preview/login` signs in as the admin. `/preview/login?account=new` signs
  in as a new member, so testers do not share one account. Both return 404
  outside preview mode. In preview, `/login` shows a link to each of them.

Locally, `pnpm dev:preview` runs the same mode with no Postgres and no `.env`.

## Coolify setup

These steps are for the resource that builds from source with
`/docker-compose.build.yaml`. Coolify supports previews for Docker Compose
apps.

1. **DNS.** Add a wildcard record, for example `*.draw.example.com`, that
   points to the server. Coolify gets a certificate for each preview host.
2. **Source.** Previews start from GitHub pull request events. They need the
   Coolify GitHub App, or a manual GitHub webhook with pull request events.
3. **Preview Deployments** tab of the resource:
   - Keep the URL template `{{pr_id}}.{{domain}}`.
   - Keep access on **Repository members only**. A preview runs the code of
     the pull request, so do not allow fork PRs.
   - Click **Enable preview deployments**.
4. **Environment Variables**, in the **Preview Deployments** section. Coolify
   copies the production values into this section. The code of a PR can read
   every variable in its container, so no production secret must stay here.
   Change these:

   | Variable | Value |
   |---|---|
   | `PREVIEW_MODE` | `true` |
   | `PREVIEW_HOSTS` | `*.draw.example.com` |
   | `BETTER_AUTH_SECRET` | A new random value (`openssl rand -base64 32`) |
   | `POSTGRES_PASSWORD` | A new random value. The compose file requires it, but the preview does not use the database |
   | `DATABASE_URL` | Empty. Preview mode does not use it, and a copied value can hold the production password |
   | `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `OIDC_CLIENT_SECRET` | Empty. Preview mode turns off single sign-on |

   Also clear any other secret that you added to production. `BASE_URL` and
   the other single sign-on variables are not secret and can keep the copied
   values. If a client secret still reaches the preview, its log shows a
   `[preview] ... set` warning at boot.

   Turn on **Runtime** for each preview variable. Coolify can copy them with
   Runtime off, and then it uses the production value in the preview.

   Also turn on **Build time** for `POSTGRES_PASSWORD`. Coolify reads the
   compose file with only the build-time variables, and the file stops the
   build if `POSTGRES_PASSWORD` has no value.
5. Open a PR. Then open `https://<pr number>.draw.example.com/preview/login`.

When the PR closes, Coolify removes its containers and volumes.

## Things to know

- **The `db` service also starts.** Coolify starts every service in the
  compose file, so each preview gets an empty Postgres container that the app
  does not use. It costs some memory while the preview runs.
- **Builds need about 4 GB of RAM.** Each push to a PR builds the image on the
  server. Compose apps cannot use a separate build server. If a preview build
  and a `main` build run together, the server can run out of memory. On a
  small server, set the server's concurrent builds to 1.
- **Coolify bugs.** If you edit a preview's domain, the next deploy resets it
  ([coolify#9399](https://github.com/coollabsio/coolify/issues/9399)). If a
  stopped preview fails with "container name already in use", delete the
  preview and deploy again
  ([coolify#9363](https://github.com/coollabsio/coolify/issues/9363)).
- If `/preview/login` returns "Host ... is not in the allowed hosts list",
  `PREVIEW_HOSTS` does not match the preview's domain.
