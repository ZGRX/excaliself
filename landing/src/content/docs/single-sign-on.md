---
title: Single sign-on
description: Let members sign in with Google Workspace, Microsoft Entra ID, or your own OIDC provider.
---

Members can sign in with Google Workspace, Microsoft Entra ID, or one OIDC
provider (Okta, Authentik, Keycloak, Zitadel, Pocket ID and others). Each
provider you configure adds a **Continue with …** button on the sign-in page.
Email and password sign-in and invites keep working.

## Who gets in

- **Existing members** sign in with any provider whose email matches their
  account. The first SSO sign-in links it, removes the account's password
  and any other SSO link, signs out its other sessions, and revokes its
  [access tokens and connected apps](/docs/mcp/#access): nobody verified the
  email behind those.
  An admin can give the password back with a
  [reset link](/docs/members/#reset-a-password). A first sign-in with a
  second provider does the same to the first provider's link.
- **New people** get an account on their first sign-in only if their email
  domain is in `SSO_ALLOWED_DOMAINS`. Everyone else needs an
  [invite link](/docs/members/#invite-someone). Without `SSO_ALLOWED_DOMAINS`,
  SSO only signs in existing members.

Each provider limits who can claim a domain:

- **Google:** only Workspace accounts of that domain. A personal Google
  account that uses a work address does not count.
- **Microsoft:** only accounts in the one tenant you set.
- **OIDC:** every account your provider signs in. Limit access to the
  application in your provider. The provider must send
  `email_verified: true`, or existing members cannot link their accounts.

Deleting a member does not stop them from signing in again with SSO: an
allowed domain recreates the account. Remove them in your provider too.

## Set it up

1. Set `BASE_URL` to the public URL.
2. Register this redirect URI with the provider:
   `<BASE_URL>/api/auth/callback/<id>`, where `<id>` is `google`,
   `microsoft`, or `oidc`.
3. Set the provider's variables below, then restart the app.

Set all the variables of a provider, or none: the app does not start with
some of them missing. PR previews ignore these settings.

| Variable | Description |
|---|---|
| `SSO_ALLOWED_DOMAINS` | Comma-separated email domains whose people join on their first sign-in, e.g. `acme.com,acme.de` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client of type **Web application** from Google Cloud Console (**APIs & Services → Credentials**) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | App registration in Microsoft Entra admin center, with a **Web** redirect URI. The tenant ID is the **Directory (tenant) ID**. `common`, `organizations` and `consumers` are refused. The app asks for `openid`, `profile`, `email` and `User.Read` (for the profile photo), not `offline_access` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Confidential client in your provider. The issuer is the URL that serves `/.well-known/openid-configuration` |
| `OIDC_NAME` | Button label, e.g. `Okta` (default `SSO`) |

## Publish the Google app

In **Testing** status, only the test users you list can sign in. To let your
whole domain in, publish the app (**In production**). An app with only the
basic scopes (`openid`, `email`, `profile`) needs no Google verification
review, but Google first needs these on the **Branding** page:

- a home page link
- a privacy policy link
- an authorized domain

## Invites and passwords

An invite link always makes a password account: the invite page has no SSO
buttons. The invited person can then use **Continue with Google** (or another
provider) with the same email. This links the account and removes its
password, as for any existing member.

A member who only uses SSO has no password, so they cannot change their email
or password under **Settings**, then **Account**. An admin can give them a
password with a [reset link](/docs/members/#reset-a-password).
