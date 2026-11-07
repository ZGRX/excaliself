import { beforeEach, expect, test, vi } from "vitest"
import { resolveRoomForToken } from "./room-token"

const { getSession, resolveShareForRoom } = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveShareForRoom: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }))
vi.mock("@/features/shares/store", () => ({ resolveShareForRoom }))

const db = {} as Parameters<typeof resolveRoomForToken>[0]
const drawing = { id: "drawing-1", deletedAt: null }
const ada = {
  id: "user-ada",
  name: "Ada Lovelace",
  email: "ada@x.dev",
  image: "https://idp.example/ada.png",
}

const resolve = () => resolveRoomForToken(db, "token", new Headers())

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue(null)
  resolveShareForRoom.mockResolvedValue({ audience: "anyone", drawing })
})

test("a member joins the drawing's room under their session name", async () => {
  getSession.mockResolvedValue({ user: ada, session: { id: "session-ada" } })

  expect(await resolve()).toEqual({
    status: "ok",
    roomId: "drawing-1",
    identity: {
      userId: "user-ada",
      sessionId: "session-ada",
      displayName: "Ada Lovelace",
      image: "https://idp.example/ada.png",
    },
  })
})

test("a guest joins an anyone link with no identity of its own", async () => {
  expect(await resolve()).toEqual({
    status: "ok",
    roomId: "drawing-1",
    identity: {
      userId: null,
      sessionId: null,
      displayName: null,
      image: null,
    },
  })
})

test("a members-only link refuses a guest", async () => {
  resolveShareForRoom.mockResolvedValue({ audience: "members", drawing })

  expect(await resolve()).toEqual({ status: "refused" })
})

test("an unknown token is refused", async () => {
  resolveShareForRoom.mockResolvedValue(null)

  expect(await resolve()).toEqual({ status: "refused" })
})

test("an empty token is refused without a lookup", async () => {
  expect(await resolveRoomForToken(db, "", new Headers())).toEqual({
    status: "refused",
  })
  expect(resolveShareForRoom).not.toHaveBeenCalled()
})
