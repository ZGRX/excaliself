---
title: Quick start
description: Run Excaliself and its Postgres database on your server with one compose file.
---

You need a server with Docker. The prebuilt image runs on amd64 and arm64, so
nothing is built on your server.

## Try it first

To look around before you install, run one container. It needs no Postgres and
no `.env`:

```bash
docker run --rm -p 127.0.0.1:3000:3000 -e PREVIEW_MODE=true ghcr.io/maciekzygmunt/excaliself
```

Open `http://localhost:3000/preview/login` to sign in as the admin, with
example drawings. To test live collaboration, open
`http://localhost:3000/preview/login?account=new` in a second browser: it signs
in as a new member. To try an AI client, use the
[preview MCP token](/docs/mcp/#try-it-in-preview-mode). Data lives in memory
and is gone when the container stops. See
[preview mode](/docs/environment/#previews).

## Install

```bash
mkdir excaliself && cd excaliself
curl -fsSLO https://raw.githubusercontent.com/maciekzygmunt/excaliself/main/docker-compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/maciekzygmunt/excaliself/main/.env.example
```

Fill in these three values in `.env`:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BASE_URL` | The public URL users open, e.g. `https://draw.example.com` |

Then start it:

```bash
docker compose up -d
```

## Create the admin account

Open `BASE_URL`. The first visit goes to `/setup`, where you create the admin
account. After that, admins send invite links from **Settings**. You can also
let people sign in with [Google, Microsoft, or OIDC](/docs/single-sign-on/).

## Next steps

- Put a reverse proxy with HTTPS in front of it: [Docker Compose](/docs/docker-compose/).
- Run it on Coolify instead: [Coolify](/docs/coolify/).
- See every setting: [Environment variables](/docs/environment/).
- Bring your team in: [Members and invites](/docs/members/).
- Take your first backup: [Backup and restore](/docs/backup-restore/).
