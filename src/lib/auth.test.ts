// @vitest-environment node
import type { GenericEndpointContext } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { expect, test, vi } from "vitest"

// The real auth config over an in-memory store, so a test can delete rows.
const store = vi.hoisted(
  () =>
    ({ user: [], session: [], account: [], verification: [] }) as Record<
      string,
      Record<string, unknown>[]
    >,
)
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => memoryAdapter(store),
}))
// Tables the hooks delete from with drizzle, outside better-auth's store.
const drizzleDeletes = vi.hoisted(() => [] as unknown[])
vi.mock("@/db", () => ({
  db: {
    delete: (table: unknown) => ({
      where: async () => drizzleDeletes.push(table),
    }),
  },
}))
vi.mock("@/env", () => ({
  env: {
    BASE_URL: "http://127.0.0.1:3000",
    PREVIEW_HOSTS: [],
    MICROSOFT_CLIENT_ID: "ms-client",
    MICROSOFT_CLIENT_SECRET: "ms-secret",
    MICROSOFT_TENANT_ID: "11111111-1111-1111-1111-111111111111",
  },
}))
// A real registry over an empty scene, so a test can seat sockets in it.
vi.mock("@/features/collab/room-registry", async () => {
  const { createRoomRegistry } = await import("@/features/collab/room-session")
  return {
    rooms: createRoomRegistry(
      async () => ({ elements: [], access: null, readable: true }),
      async () => {},
    ),
  }
})
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-00")
// An OIDC provider with no network: each callback gets the profile set here.
const idp = vi.hoisted(() => ({
  profile: { id: "", email: "", emailVerified: true, name: "" },
}))
vi.mock("@/features/auth/sso", async (importOriginal) => {
  const { genericOAuth } = await import("better-auth/plugins/generic-oauth")
  return {
    ...(await importOriginal<typeof import("@/features/auth/sso")>()),
    mayJoinWithSso: () => false,
    ssoPlugins: [
      genericOAuth({
        config: [
          {
            providerId: "oidc",
            clientId: "client",
            clientSecret: "secret",
            authorizationUrl: "http://idp.test/authorize",
            getToken: async () => ({ accessToken: "token" }),
            getUserInfo: async () => idp.profile,
          },
        ],
      }),
    ],
  }
})

const { auth } = await import("./auth")
const { accessTokens, oauthGrants } = await import("@/db/schema")
const { rooms } = await import("@/features/collab/room-registry")
const { joinRoom, receiveFromPeer } = await import(
  "@/features/collab/room-session"
)

/** The cookies a sign-up sets, sent back as a browser would. */
async function signedInHeaders() {
  const { headers } = await auth.api.signUpEmail({
    body: { email: "dave@example.com", password: "password-123", name: "Dave" },
    returnHeaders: true,
  })
  const cookie = headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ")
  return new Headers({ cookie })
}

test("a session deleted from the db is refused at once", async () => {
  const headers = await signedInHeaders()
  expect(await auth.api.getSession({ headers })).not.toBeNull()

  // As a user delete's FK cascade does.
  store.session.length = 0

  expect(await auth.api.getSession({ headers })).toBeNull()
})

test("linking SSO to a password account ends its password, sessions and tokens", async () => {
  const { user } = await auth.api.signUpEmail({
    body: { email: "erin@example.com", password: "password-123", name: "" },
  })
  const rows = (table: string) =>
    store[table].filter((row) => row.userId === user.id)
  expect(rows("session")).toHaveLength(1)

  const link = auth.options.databaseHooks?.account?.create?.after
  const now = new Date()
  await link?.(
    {
      id: "google-row",
      providerId: "google",
      accountId: "google-sub",
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
    { context: await auth.$context } as GenericEndpointContext,
  )

  expect(rows("account").map((row) => row.providerId)).toEqual([])
  expect(rows("session")).toEqual([])
  expect(drizzleDeletes).toEqual([accessTokens, oauthGrants])
})

const cookieOf = (headers: Headers) =>
  new Headers({
    cookie: headers
      .getSetCookie()
      .map((setCookie) => setCookie.split(";")[0])
      .join("; "),
  })

/** One more device signed in as `email`: its cookie, token and session id. */
async function device(email: string) {
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password: "password-123" },
    returnHeaders: true,
  })
  const row = store.session.find((session) => session.token === response.token)
  return {
    headers: cookieOf(headers),
    token: response.token,
    sessionId: String(row?.id),
    userId: response.user.id,
  }
}

type Device = Awaited<ReturnType<typeof device>>

/** A socket seated in a Room by `owner`'s session, as the upgrade does. */
async function seat(roomId: string, owner: Device) {
  const closes: { code: number; reason: string }[] = []
  const peer = {
    id: `peer-${owner.sessionId}`,
    bufferedAmount: 0,
    send() {},
    publish() {},
    subscribe() {},
    close: (code: number, reason: string) => void closes.push({ code, reason }),
  }
  await joinRoom(rooms, roomId, peer, {
    userId: owner.userId,
    sessionId: owner.sessionId,
    displayName: "Dave",
  })
  // Draws one element named after the socket.
  const edit = JSON.stringify({
    type: "SCENE_UPDATE",
    payload: {
      elements: [{ id: peer.id, version: 1, versionNonce: 1, index: "a0" }],
    },
  })
  return {
    id: peer.id,
    closes,
    draw: () => receiveFromPeer(rooms, roomId, peer, edit),
  }
}

type Ended = "other" | "here" | "both"

test.each<[string, (here: Device, other: Device) => Promise<unknown>, Ended]>([
  [
    "revoking one device",
    (here, other) =>
      auth.api.revokeSession({
        headers: here.headers,
        body: { token: other.token },
      }),
    "other",
  ],
  [
    "signing out the other devices",
    (here) => auth.api.revokeOtherSessions({ headers: here.headers }),
    "other",
  ],
  [
    "signing out every device",
    (here) => auth.api.revokeSessions({ headers: here.headers }),
    "both",
  ],
  [
    "a password change that signs out the others",
    (here) =>
      auth.api.changePassword({
        headers: here.headers,
        body: {
          currentPassword: "password-123",
          newPassword: "password-123",
          revokeOtherSessions: true,
        },
      }),
    // Re-issued, so this tab's socket rejoins with the new cookie.
    "both",
  ],
  [
    "signing out",
    (here) => auth.api.signOut({ headers: here.headers }),
    "here",
  ],
])(
  "%s hangs up the room seats of the ended sessions",
  async (name, end, ended) => {
    const email = `${name.replaceAll(" ", "-")}@example.com`
    await auth.api.signUpEmail({
      body: { email, password: "password-123", name: "Dave" },
    })
    const here = await device(email)
    const other = await device(email)
    const roomId = `room-${name}`
    const seats = {
      here: await seat(roomId, here),
      other: await seat(roomId, other),
    }

    await end(here, other)
    await seats.other.draw()
    await seats.here.draw()

    const ends = (who: keyof typeof seats) => ended === who || ended === "both"
    const rejoin = { code: 1000, reason: "Rejoin" }
    expect(seats.here.closes).toEqual(ends("here") ? [rejoin] : [])
    expect(seats.other.closes).toEqual(ends("other") ? [rejoin] : [])
    const drawn = rooms.rooms.get(roomId)?.elements.map((element) => element.id)
    const kept = (["here", "other"] as const).filter((who) => !ends(who))
    expect(drawn ?? []).toEqual(kept.map((who) => seats[who].id))
  },
)

test("a session can't fetch or refresh the member's IdP tokens", async () => {
  // Entra's token endpoint, for the refresh.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        access_token: "graph-2",
        refresh_token: "refresh-2",
        id_token: "id-2",
        expires_in: 3600,
      }),
    ),
  )
  const email = "frank@example.com"
  const { user } = await auth.api.signUpEmail({
    body: { email, password: "password-123", name: "Frank" },
  })
  const now = new Date()
  store.account.push({
    id: "ms-row",
    providerId: "microsoft",
    accountId: "oid-1",
    userId: user.id,
    accessToken: "graph-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  })
  const { headers } = await device(email)
  const call = (path: string, init: RequestInit = {}) =>
    auth.handler(
      new Request(`http://127.0.0.1:3000/api/auth${path}`, {
        ...init,
        headers: {
          cookie: headers.get("cookie") ?? "",
          "content-type": "application/json",
        },
      }),
    )
  const post = (path: string) =>
    call(path, {
      method: "POST",
      body: JSON.stringify({ accountId: "ms-row" }),
    })

  const responses = await Promise.all([
    post("/refresh-token"),
    post("/get-access-token"),
    call("/account-info?accountId=ms-row"),
  ])

  vi.unstubAllGlobals()
  expect(
    await Promise.all(
      responses.map(async (response) => [
        response.status,
        await response.text(),
      ]),
    ),
  ).toEqual([
    [404, expect.anything()],
    [404, expect.anything()],
    [404, expect.anything()],
  ])
})

test("Microsoft sign-in asks for no refresh token", async () => {
  const { url } = await auth.api.signInSocial({
    body: { provider: "microsoft", callbackURL: "/" },
  })

  expect(new URL(String(url)).searchParams.get("scope")).toBe(
    "openid profile email User.Read",
  )
})

const origin = "http://127.0.0.1:3000"
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ")

/** Starts an OIDC flow at path; the result finishes it as the given identity. */
async function startOidc(
  path: "/sign-in/social" | "/link-social",
  cookie = "",
) {
  const start = await auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ provider: "oidc", callbackURL: "/" }),
    }),
  )
  const { url } = (await start.json()) as { url: string }
  const state = new URL(url).searchParams.get("state")
  return (id: string, email: string) => {
    idp.profile = { id, email, emailVerified: true, name: "" }
    return auth.handler(
      new Request(`${origin}/api/auth/callback/oidc?code=c&state=${state}`, {
        headers: { cookie: `${cookie}; ${cookiesOf(start)}` },
      }),
    )
  }
}
const providersOf = (userId: string) =>
  store.account
    .filter((row) => row.userId === userId)
    .map((row) => `${row.providerId}:${row.accountId}`)

test("a link begun before an email change is refused", async () => {
  const signUp = await auth.api.signUpEmail({
    body: { email: "m@corp.test", password: "password-123", name: "M" },
    returnHeaders: true,
  })
  const userId = signUp.response.user.id
  const cookie = cookiesOf(new Response(null, { headers: signUp.headers }))
  const finish = await startOidc("/link-social", cookie)

  // As changeEmail does. The link state still holds m@corp.test.
  const user = store.user.find((row) => row.id === userId)
  if (user) user.email = "v@corp.test"
  const callback = await finish("m-sub", "m@corp.test")

  expect(callback.headers.get("location")).toContain(
    "error=email_does_not_match",
  )
  expect(providersOf(userId)).toEqual([`credential:${userId}`])
})

test("the owner's first SSO sign-in ends other SSO links to the account", async () => {
  const { user } = await auth.api.signUpEmail({
    body: { email: "n@corp.test", password: "password-123", name: "N" },
  })
  await (await startOidc("/sign-in/social"))("n-sub", "n@corp.test")
  // N gets a password back from an admin reset, then changes email.
  const row = store.user.find((u) => u.id === user.id)
  if (row) row.email = "w@corp.test"

  const owner = await (await startOidc("/sign-in/social"))(
    "w-sub",
    "w@corp.test",
  )
  const again = await (await startOidc("/sign-in/social"))(
    "n-sub",
    "n@corp.test",
  )

  const sessionOf = (response: Response) =>
    auth.api.getSession({
      headers: new Headers({ cookie: cookiesOf(response) }),
    })
  expect(providersOf(user.id)).toEqual(["oidc:w-sub"])
  expect((await sessionOf(owner))?.user.id).toBe(user.id)
  expect(await sessionOf(again)).toBeNull()
})

// Generic OIDC would take the identity from the request's access token.
test.each(["/sign-in/social", "/link-social"])(
  "%s refuses an ID token",
  async (path) => {
    const res = await auth.handler(
      new Request(`http://127.0.0.1:3000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "oidc",
          idToken: { token: "id-token", accessToken: "access-token" },
        }),
      }),
    )
    expect(res.status).toBe(403)
  },
)
