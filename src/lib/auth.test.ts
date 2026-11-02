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
  env: { BASE_URL: "http://127.0.0.1:3000", PREVIEW_HOSTS: [] },
}))
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-00")

const { auth } = await import("./auth")
const { accessTokens } = await import("@/db/schema")

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

  const link = auth.options.databaseHooks?.account?.create?.before
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
  expect(drizzleDeletes).toEqual([accessTokens])
})
