// @vitest-environment node
import { expect, test, vi } from "vitest"

// better-auth turns its limiter on only in production, read at import.
vi.hoisted(() => {
  process.env.NODE_ENV = "production"
})
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory")
  return {
    drizzleAdapter: () =>
      memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  }
})
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/env", () => ({
  env: { BASE_URL: "http://127.0.0.1:3000", PREVIEW_HOSTS: [] },
}))
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-00")

const { authHandler } = await import("./$")

/** A password guess as srvx hands it over: `ip` is the socket peer. */
const signIn = (peer: string, forwardedFor?: string) =>
  authHandler(
    Object.assign(
      new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          ...(forwardedFor && { "x-forwarded-for": forwardedFor }),
        },
        body: JSON.stringify({ email: "ada@example.com", password: "guess" }),
      }),
      { ip: peer },
    ),
  )

const statuses = async (attempts: Array<() => Promise<Response>>) => {
  const result: number[] = []
  for (const attempt of attempts) result.push((await attempt()).status)
  return result
}

test("a public peer can't mint fresh sign-in budgets by rotating X-Forwarded-For", async () => {
  const guesses = [1, 2, 3, 4].map(
    (n) => () => signIn("203.0.113.10", `198.51.100.${n}`),
  )

  expect((await statuses(guesses)).at(-1)).toBe(429)
})

test("public peers that send no X-Forwarded-For don't share one budget", async () => {
  const flood = [1, 2, 3, 4].map(() => () => signIn("203.0.113.20"))
  expect((await statuses(flood)).at(-1)).toBe(429)

  expect((await signIn("203.0.113.21")).status).not.toBe(429)
})
