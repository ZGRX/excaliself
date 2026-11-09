---
title: Railway
description: Deploy with one click from the Railway template, or set up the prebuilt image and a Postgres database by hand.
---

## Deploy with the template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/excaliself)

The template adds the app and a Postgres database, with the settings below
already in place. It generates the auth secret and a domain. When the deploy
finishes, open the domain to create the admin account.

## Deploy by hand

1. In a new Railway project, add a **PostgreSQL** database.
2. Add a service from the Docker image `ghcr.io/maciekzygmunt/excaliself:latest`.
3. In the service's **Settings → Networking**, generate a domain with port
   `3000`.
4. In the service's **Variables**, set:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `BETTER_AUTH_SECRET` | The output of `openssl rand -base64 32` |
   | `BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
   | `PORT` | `3000` |

5. Deploy, and open the domain to create the admin account.

`DATABASE_URL` points at Postgres over Railway's private network, so the
database needs no public access. Drawings live in the database's volume and
survive redeploys. The other settings, such as
[single sign-on](/docs/single-sign-on/), are in
[Environment variables](/docs/environment/).

## Upgrade or pin a version

Railway does not pull a newer image on its own, and a plain redeploy keeps the
old one. To upgrade, click the update button that appears in the service's
settings, or turn on automatic updates there. To pin a version, turn
automatic updates off and use a release tag in the image name, e.g.
`ghcr.io/maciekzygmunt/excaliself:1.2.3`. Automatic updates move a release tag
to newer releases.
