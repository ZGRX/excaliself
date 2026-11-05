// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/db")
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-00")
  // Vitest sets BASE_URL to "/", which is not a URL.
  vi.stubEnv("BASE_URL", "http://127.0.0.1:3000")
  vi.stubEnv("MCP_STDIO", "true")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

// stdio has no sign-in, so it must never reach a real database.
test("MCP_STDIO refuses to start without preview mode", async () => {
  vi.stubEnv("PREVIEW_MODE", "")
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  await expect(import("./env")).rejects.toThrow("Invalid environment variables")
  expect(errors.mock.calls[0]?.[1]).toEqual([
    expect.objectContaining({
      path: ["MCP_STDIO"],
      message: "MCP_STDIO=true needs PREVIEW_MODE=true",
    }),
  ])
})

test("MCP_STDIO starts in preview mode", async () => {
  vi.stubEnv("PREVIEW_MODE", "true")
  const { env } = await import("./env")
  expect(env.MCP_STDIO).toBe(true)
})
