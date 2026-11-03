// @vitest-environment node
import { eq } from "drizzle-orm"
import { beforeEach, expect, test, vi } from "vitest"
import { accounts, passwordResets } from "@/db/schema"

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

const request = vi.hoisted(() => ({ ip: "203.0.113.1" }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
  getRequest: () =>
    new Request("http://app.test/_serverFn/reset", {
      headers: { "x-forwarded-for": request.ip },
    }),
}))

const hash = vi.hoisted(() => vi.fn(async () => "hashed"))
vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({ password: { hash } }),
    api: { signInEmail: async () => {} },
  },
}))
vi.mock("@/middleware/admin", () => ({ adminMiddleware: {} }))

vi.mock("@/db", async () => {
  const { createPreviewDb } = await import("@/db/preview")
  return { db: await createPreviewDb() }
})

const { db } = await import("@/db")
const { demoAdmin } = await import("@/db/demo-content")
const { FAILED_RESETS_PER_MINUTE, resetPasswordWithToken } = await import(
  "./server"
)

const reset = (token: string, password = "new-password") =>
  resetPasswordWithToken({ data: { token, password } })

let nextIp = 0
beforeEach(async () => {
  hash.mockClear()
  // One pending link per user.
  await db.delete(passwordResets)
  // The limiter is process-wide, so each test comes from an IP of its own.
  request.ip = `203.0.113.${++nextIp}`
})

async function issueReset(token: string) {
  await db.insert(passwordResets).values({
    id: token,
    token,
    userId: demoAdmin.id,
    expiresAt: new Date(Date.now() + 60_000),
  })
}

test("an unknown token is refused before the password is hashed", async () => {
  await expect(reset("no-such-token")).rejects.toThrow(
    "Invalid or expired reset link",
  )
  expect(hash).not.toHaveBeenCalled()
})

test("a password past better-auth's maximum length is refused", async () => {
  await issueReset("token-long")

  await expect(reset("token-long", "a".repeat(129))).rejects.toThrow()
  expect(hash).not.toHaveBeenCalled()
})

test("an IP that keeps failing is turned away, even with a good token", async () => {
  await issueReset("token-limited")
  for (let i = 0; i < FAILED_RESETS_PER_MINUTE; i++)
    await reset("guess").catch(() => {})

  await expect(reset("token-limited")).rejects.toThrow("Too many attempts")

  request.ip = "198.51.100.7"
  await expect(reset("token-limited")).resolves.toBeUndefined()
})

test("a good token still sets the new password and is used up", async () => {
  await issueReset("token-good")

  await reset("token-good")

  expect(hash).toHaveBeenCalledWith("new-password")
  const [credential] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(eq(accounts.userId, demoAdmin.id))
  expect(credential.password).toBe("hashed")
  await expect(reset("token-good")).rejects.toThrow(
    "Invalid or expired reset link",
  )
})
