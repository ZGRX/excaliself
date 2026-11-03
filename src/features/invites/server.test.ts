// @vitest-environment node
import { eq } from "drizzle-orm"
import { expect, test, vi } from "vitest"
import { invites, users } from "@/db/schema"

// Server fns without the Start compiler: each one is its validator + handler.
vi.mock("@tanstack/react-start", () => {
  type Chain = {
    middleware: () => Chain
    validator: (schema: { parse(data: unknown): unknown }) => Chain
    handler: (
      fn: (opts: { data: unknown }) => unknown,
    ) => (opts: { data: unknown }) => unknown
  }
  const chain = (schema?: { parse(data: unknown): unknown }): Chain => ({
    middleware: () => chain(schema),
    validator: (next) => chain(next),
    handler: (fn) => async (opts) =>
      fn({ data: schema ? schema.parse(opts.data) : opts.data }),
  })
  return { createServerFn: () => chain() }
})
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
}))
vi.mock("@/middleware/admin", () => ({ adminMiddleware: {} }))
vi.mock("@/env", () => ({
  env: { BASE_URL: "http://127.0.0.1:3000", PREVIEW_HOSTS: [] },
}))
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-00")
vi.mock("@/features/collab/room-registry", async () => {
  const { createRoomRegistry } = await import("@/features/collab/room-session")
  return {
    rooms: createRoomRegistry(
      async () => ({ elements: [], access: null, readable: true }),
      async () => {},
    ),
  }
})
// The real better-auth over the real migrations.
vi.mock("@/db", async () => {
  const { createPreviewDb } = await import("@/db/preview")
  return { db: await createPreviewDb() }
})

const { db } = await import("@/db")
const { demoAdmin } = await import("@/db/demo-content")
const { auth } = await import("@/lib/auth")
const { registerWithInvite } = await import("./server")

async function issueInvite(token: string) {
  await db.insert(invites).values({
    id: token,
    token,
    invitedBy: demoAdmin.id,
    expiresAt: new Date(Date.now() + 60_000),
  })
}

const register = (token: string, email: string) =>
  registerWithInvite({ data: { token, email, password: "password-123" } })

const signsIn = (email: string) =>
  auth.api
    .signInEmail({ body: { email, password: "password-123" } })
    .then(() => true)
    .catch(() => false)

test("parallel registrations with one invite make one account", async () => {
  await issueInvite("token-race")
  const emails = ["a@race.test", "b@race.test", "c@race.test"]

  const results = await Promise.allSettled(
    emails.map((email) => register("token-race", email)),
  )

  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  const signIns = await Promise.all(emails.map(signsIn))
  expect(signIns.filter(Boolean)).toHaveLength(1)
  const [invite] = await db
    .select({ usedBy: invites.usedBy })
    .from(invites)
    .where(eq(invites.id, "token-race"))
  const [winner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, String(invite.usedBy)))
  expect(signIns[emails.indexOf(winner.email)]).toBe(true)
})

test("a failed registration leaves the invite usable", async () => {
  await issueInvite("token-retry")

  // The demo admin's email is taken, so better-auth refuses it.
  await expect(register("token-retry", demoAdmin.email)).rejects.toThrow()

  await expect(
    register("token-retry", "retry@invite.test"),
  ).resolves.toBeUndefined()
  await expect(register("token-retry", "again@invite.test")).rejects.toThrow(
    "Invalid or expired invite link",
  )
})
