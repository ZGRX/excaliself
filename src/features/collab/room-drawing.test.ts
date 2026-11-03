import { beforeEach, expect, test, vi } from "vitest"
import type { Space } from "@/db/schema"
import { resolveRoomForDrawing } from "./room-drawing"

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }))

type Row = {
  id: string
  space: Space
  createdBy: string | null
  deletedAt: Date | null
}

const ada = { id: "user-ada", name: "Ada Lovelace", email: "ada@x.dev" }
const teamDrawing: Row = {
  id: "drawing-1",
  space: "team",
  createdBy: "user-bob",
  deletedAt: null,
}

/** Answers the id lookup with `row`, or with nothing. */
const dbWith = (row: Row | null) => {
  const where = vi.fn(async () => (row ? [row] : []))
  const db = {
    select: () => ({ from: () => ({ where }) }),
  } as unknown as Parameters<typeof resolveRoomForDrawing>[0]
  return { db, where }
}

const resolve = (row: Row | null) =>
  resolveRoomForDrawing(dbWith(row).db, "drawing-1", new Headers())

const REFUSED = { status: "refused" }

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: ada, session: { id: "session-ada" } })
})

test("a member joins a Team drawing's room under their session name", async () => {
  expect(await resolve(teamDrawing)).toEqual({
    status: "ok",
    // The token entry's Room id too, so guests on a link land here.
    roomId: "drawing-1",
    identity: {
      userId: "user-ada",
      sessionId: "session-ada",
      displayName: "Ada Lovelace",
    },
  })
})

test("someone else's private drawing is refused", async () => {
  expect(await resolve({ ...teamDrawing, space: "private" })).toEqual(REFUSED)
})

// Private rooms are reached through their Share link only.
test("the member's own private drawing is refused too", async () => {
  expect(
    await resolve({ ...teamDrawing, space: "private", createdBy: "user-ada" }),
  ).toEqual(REFUSED)
})

test("a trashed Team drawing is refused", async () => {
  expect(await resolve({ ...teamDrawing, deletedAt: new Date() })).toEqual(
    REFUSED,
  )
})

test("a missing drawing is refused", async () => {
  expect(await resolve(null)).toEqual(REFUSED)
})

test("no session is refused without a lookup", async () => {
  getSession.mockResolvedValue(null)
  const { db, where } = dbWith(teamDrawing)

  expect(await resolveRoomForDrawing(db, "drawing-1", new Headers())).toEqual(
    REFUSED,
  )
  expect(where).not.toHaveBeenCalled()
})
