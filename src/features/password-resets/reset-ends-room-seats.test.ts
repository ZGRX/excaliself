// @vitest-environment node
import { expect, test, vi } from "vitest"
import { passwordResets, sessions } from "@/db/schema"
import type { RoomPeer } from "@/features/collab/room-session"

// Server fns without the Start compiler: each one is just its handler.
vi.mock("@tanstack/react-start", () => {
  const chain = () => ({
    middleware: chain,
    validator: chain,
    handler: (fn: unknown) => fn,
  })
  return { createServerFn: chain }
})
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
  getRequest: () => new Request("http://localhost/"),
}))
vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({ password: { hash: async () => "hashed" } }),
    api: { signInEmail: async () => {} },
  },
}))
vi.mock("@/middleware/admin", () => ({ adminMiddleware: {} }))
vi.mock("@/db", async () => {
  const { createPreviewDb } = await import("@/db/preview")
  return { db: await createPreviewDb() }
})
vi.mock("@/features/collab/room-registry", async () => {
  const { createRoomRegistry } = await import("@/features/collab/room-session")
  return {
    rooms: createRoomRegistry(
      async () => ({ elements: [], access: null, readable: true }),
      async () => {},
    ),
  }
})

const { db } = await import("@/db")
const { demoAdmin } = await import("@/db/demo-content")
const { rooms } = await import("@/features/collab/room-registry")
const { joinRoom } = await import("@/features/collab/room-session")
const { resetPasswordWithToken } = await import("./server")

test("a reset link hangs up the room seats of the sessions it ends", async () => {
  const closes: { code: number; reason: string }[] = []
  const peer: RoomPeer = {
    id: "peer-1",
    bufferedAmount: 0,
    send() {},
    publish() {},
    subscribe() {},
    close: (code, reason) => void closes.push({ code, reason }),
  }
  await joinRoom(rooms, "drawing-1", peer, {
    userId: demoAdmin.id,
    sessionId: "stolen-session",
    displayName: "Admin",
    image: null,
  })
  await db.insert(sessions).values({
    id: "stolen-session",
    token: "stolen-token",
    userId: demoAdmin.id,
    expiresAt: new Date(Date.now() + 60_000),
  })
  await db.insert(passwordResets).values({
    id: "reset-1",
    token: "token-1",
    userId: demoAdmin.id,
    expiresAt: new Date(Date.now() + 60_000),
  })

  await (
    resetPasswordWithToken as unknown as (opts: {
      data: { token: string; password: string }
    }) => Promise<void>
  )({ data: { token: "token-1", password: "new-password" } })

  expect(closes).toEqual([{ code: 1000, reason: "Rejoin" }])
  expect(rooms.rooms.has("drawing-1")).toBe(false)
})
