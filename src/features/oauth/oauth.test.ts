// @vitest-environment node
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { beforeAll, expect, test, vi } from "vitest"
import type { Db } from "@/db"
import { createPreviewDb } from "@/db/preview"
import { users } from "@/db/schema"
import { checkAuthorizeRequest } from "./authorize"
import {
  createGrant,
  listGrants,
  memberForOAuthToken,
  redirectUriMatches,
  revokeGrant,
} from "./grants"

vi.mock("@/env", () => ({ env: {} }))
const { register, token } = await import("./endpoints")

const ORIGIN = "https://draw.example.com"
const CALLBACK = "https://claude.ai/api/mcp/auth_callback"

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
}, 30_000)

async function addMember() {
  const id = randomUUID()
  await db.insert(users).values({ id, name: "Ada", email: `${id}@example.com` })
  return id
}

const post = (path: string, body: string, type: string) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": type },
    body,
  })

async function registerClient(redirectUris = [CALLBACK]) {
  const response = await register(
    db,
    post(
      "/api/oauth/register",
      JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris }),
      "application/json",
    ),
  )
  return { status: response.status, body: await response.json() }
}

const callToken = async (params: Record<string, string>) => {
  const response = await token(
    db,
    post(
      "/api/oauth/token",
      new URLSearchParams(params).toString(),
      "application/x-www-form-urlencoded",
    ),
  )
  return { status: response.status, body: await response.json() }
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

/** Register, consent as a new member, and return what the client holds. */
async function authorize() {
  const userId = await addMember()
  const { body: client } = await registerClient()
  const { verifier, challenge } = pkce()
  const code = await createGrant(db, {
    userId,
    clientId: client.client_id,
    redirectUri: CALLBACK,
    codeChallenge: challenge,
  })
  const exchange = {
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    code_verifier: verifier,
    resource: `${ORIGIN}/api/mcp`,
  }
  return { userId, clientId: client.client_id as string, exchange }
}

test("a code buys tokens that act as the member, refresh rotates them, and a replay ends the grant", async () => {
  const { userId, clientId, exchange } = await authorize()

  const first = await callToken(exchange)
  expect(first.status).toBe(200)
  expect(first.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 })
  expect(await memberForOAuthToken(db, first.body.access_token)).toMatchObject({
    id: userId,
  })

  const refreshed = await callToken({
    grant_type: "refresh_token",
    refresh_token: first.body.refresh_token,
    client_id: clientId,
  })
  expect(refreshed.status).toBe(200)
  expect(
    await memberForOAuthToken(db, refreshed.body.access_token),
  ).toMatchObject({ id: userId })
  // Both old tokens died with the rotation.
  expect(await memberForOAuthToken(db, first.body.access_token)).toBeNull()
  const replay = await callToken({
    grant_type: "refresh_token",
    refresh_token: first.body.refresh_token,
    client_id: clientId,
  })
  expect(replay).toMatchObject({
    status: 400,
    body: { error: "invalid_grant" },
  })
  // The replay means a second holder, so the newest tokens end too.
  expect(await memberForOAuthToken(db, refreshed.body.access_token)).toBeNull()
  const newest = await callToken({
    grant_type: "refresh_token",
    refresh_token: refreshed.body.refresh_token,
    client_id: clientId,
  })
  expect(newest.body.error).toBe("invalid_grant")
  expect(await listGrants(db, userId)).toEqual([])
})

test("a code works once", async () => {
  const { exchange } = await authorize()
  expect((await callToken(exchange)).status).toBe(200)
  expect(await callToken(exchange)).toMatchObject({
    status: 400,
    body: { error: "invalid_grant" },
  })
})

test("a wrong PKCE verifier burns the code", async () => {
  const { exchange } = await authorize()
  const wrong = await callToken({
    ...exchange,
    code_verifier: pkce().verifier,
  })
  expect(wrong.body.error).toBe("invalid_grant")
  // The right verifier is too late now.
  expect((await callToken(exchange)).body.error).toBe("invalid_grant")
})

test("the code is bound to its client and redirect URI", async () => {
  const other = await registerClient()
  const stolen = (await authorize()).exchange
  const asOtherClient = await callToken({
    ...stolen,
    client_id: other.body.client_id,
  })
  expect(asOtherClient.body.error).toBe("invalid_grant")

  const redirected = (await authorize()).exchange
  const elsewhere = await callToken({
    ...redirected,
    redirect_uri: "https://claude.ai/elsewhere",
  })
  expect(elsewhere.body.error).toBe("invalid_grant")
})

test("a token for another resource is refused", async () => {
  const { exchange } = await authorize()
  const response = await callToken({
    ...exchange,
    resource: "https://other.example.com/api/mcp",
  })
  expect(response.body.error).toBe("invalid_target")
})

test("revoking, or deleting the member, ends the grant", async () => {
  const revoked = await authorize()
  const revokedTokens = (await callToken(revoked.exchange)).body
  const [app] = await listGrants(db, revoked.userId)
  expect(app).toMatchObject({ clientName: "Claude", redirectHost: "claude.ai" })
  await revokeGrant(db, revoked.userId, app.id)
  expect(await memberForOAuthToken(db, revokedTokens.access_token)).toBeNull()

  const deleted = await authorize()
  const deletedTokens = (await callToken(deleted.exchange)).body
  await db.delete(users).where(eq(users.id, deleted.userId))
  expect(await memberForOAuthToken(db, deletedTokens.access_token)).toBeNull()
  const refresh = await callToken({
    grant_type: "refresh_token",
    refresh_token: deletedTokens.refresh_token,
    client_id: deleted.clientId,
  })
  expect(refresh.body.error).toBe("invalid_grant")
})

test("a member can't revoke someone else's grant", async () => {
  const { userId, exchange } = await authorize()
  await callToken(exchange)
  const [app] = await listGrants(db, userId)
  await expect(revokeGrant(db, await addMember(), app.id)).rejects.toThrow()
})

test("an unexchanged code isn't listed as a connected app", async () => {
  const { userId } = await authorize()
  expect(await listGrants(db, userId)).toEqual([])
})

test("registration takes only https or loopback redirect URIs", async () => {
  expect((await registerClient(["http://evil.example/cb"])).body.error).toBe(
    "invalid_redirect_uri",
  )
  expect((await registerClient(["myapp://callback"])).body.error).toBe(
    "invalid_redirect_uri",
  )
  expect(
    (await registerClient([`https://claude.ai/${"a".repeat(2000)}`])).body
      .error,
  ).toBe("invalid_client_metadata")
  const ok = await registerClient(["http://localhost:3334/oauth/callback"])
  expect(ok).toMatchObject({
    status: 201,
    body: { token_endpoint_auth_method: "none", client_name: "Claude" },
  })
})

test("a loopback redirect URI matches on any port, others match exactly", () => {
  const registered = ["http://127.0.0.1:3334/callback", CALLBACK]
  expect(redirectUriMatches(registered, "http://127.0.0.1:5555/callback")).toBe(
    true,
  )
  expect(redirectUriMatches(registered, "http://127.0.0.1:5555/other")).toBe(
    false,
  )
  expect(redirectUriMatches(registered, `${CALLBACK}/`)).toBe(false)
  expect(
    redirectUriMatches(
      registered,
      "https://claude.ai:8443/api/mcp/auth_callback",
    ),
  ).toBe(false)
})

test("an authorization request needs a registered redirect URI and S256 PKCE", async () => {
  const { body: client } = await registerClient()
  const valid = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    code_challenge: pkce().challenge,
    code_challenge_method: "S256",
    state: "123",
    resource: `${ORIGIN}/api/mcp/`,
  }
  expect(await checkAuthorizeRequest(db, valid, ORIGIN)).toMatchObject({
    kind: "ok",
    clientName: "Claude",
    state: "123",
  })
  // Never send the member to an address the client didn't register.
  expect(
    await checkAuthorizeRequest(
      db,
      { ...valid, redirect_uri: "https://evil.example/cb" },
      ORIGIN,
    ),
  ).toMatchObject({ kind: "invalid" })
  expect(
    await checkAuthorizeRequest(db, { ...valid, client_id: "nope" }, ORIGIN),
  ).toMatchObject({ kind: "invalid" })

  const plain = await checkAuthorizeRequest(
    db,
    { ...valid, code_challenge_method: "plain" },
    ORIGIN,
  )
  expect(plain.kind).toBe("error")
  const url = new URL(plain.kind === "error" ? plain.redirectTo : "")
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    error: "invalid_request",
    state: "123",
    iss: ORIGIN,
  })
  expect(
    await checkAuthorizeRequest(
      db,
      { ...valid, resource: "https://other.example/api/mcp" },
      ORIGIN,
    ),
  ).toMatchObject({ kind: "error" })
})
