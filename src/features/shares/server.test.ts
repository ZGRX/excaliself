// @vitest-environment node
import { expect, test, vi } from "vitest"
import type { ShareResolution } from "./store"
import { FAILED_TOKEN_LOOKUPS_PER_MINUTE } from "./token-rate-limit"

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

const request = vi.hoisted(() => ({ ip: "", status: 200 }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers({ "x-forwarded-for": request.ip }),
  getRequestIP: () => undefined,
  setResponseStatus: (status: number) => {
    request.status = status
  },
}))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth", () => ({ auth: {} }))
vi.mock("@/middleware/auth", () => ({ authMiddleware: {} }))
vi.mock("@/features/collab/room-registry", () => ({ rooms: {} }))
vi.mock("@/features/collab/room-session", () => ({}))

const LIVE = "live-token"
vi.mock("./store", () => ({
  resolveShareVisit: async (_db: unknown, token: string) =>
    (token === LIVE
      ? { status: "signin", drawingName: "Plan" }
      : { status: "dead" }) satisfies ShareResolution,
}))

const { resolveShareToken } = await import("./server")

const visit = async (ip: string, token: string) => {
  request.ip = ip
  request.status = 200
  const result = await resolveShareToken({ data: token })
  return { status: request.status, visit: result.status }
}

const guess = async (ip: string, times: number) => {
  for (let i = 0; i < times; i++) await visit(ip, `junk-${i}`)
}

test("a live link still opens from an IP that spent its budget", async () => {
  const ip = "203.0.113.40"
  await guess(ip, FAILED_TOKEN_LOOKUPS_PER_MINUTE * 2)

  expect(await visit(ip, LIVE)).toEqual({ status: 200, visit: "signin" })
})

test("dead links are throttled once the budget is spent", async () => {
  const ip = "203.0.113.41"
  await guess(ip, FAILED_TOKEN_LOOKUPS_PER_MINUTE)

  expect(await visit(ip, "one-more")).toEqual({
    status: 429,
    visit: "throttled",
  })
})
