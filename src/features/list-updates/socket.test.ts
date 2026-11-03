import { beforeEach, expect, test, vi } from "vitest"
import { auth } from "@/lib/auth"
import {
  SERVER_RESTART_CLOSE_CODE,
  SERVER_RESTART_CLOSE_REASON,
} from "@/lib/socket/shutdown"
import { listUpdates } from "./hub"
import {
  LIBRARY_CHANGED,
  LISTS_CHANGED,
  PING,
  PONG,
  SIGNED_OUT_CLOSE_CODE,
} from "./protocol"

// Hand back the hooks themselves, so a test can drive them directly.
vi.mock("nitro", () => ({ defineWebSocketHandler: (hooks: unknown) => hooks }))
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock("@/env", () => ({ env: {} }))

const { listsSocket } = await import("./socket")

type Hooks = {
  upgrade(request: Request): Promise<{ context: object } | undefined>
  open(peer: FakePeer): void
  message(peer: FakePeer, message: { text(): string }): void
  close(peer: FakePeer): void
}
const hooks = listsSocket as unknown as Hooks

type FakePeer = ReturnType<typeof fakePeer>
const fakePeer = (context: object = {}) => ({
  context: { ...context },
  send: vi.fn(),
  close: vi.fn(),
})

/** Runs the handshake the way crossws does: upgrade's context lands on the peer. */
async function connect(
  session: { user: { id: string } } | null,
  headers: HeadersInit = {},
) {
  vi.mocked(auth.api.getSession).mockResolvedValue(session as never)
  const accepted = await hooks.upgrade(
    new Request("http://app.test/ws/lists", { headers }),
  )
  const peer = fakePeer(accepted?.context)
  hooks.open(peer)
  return peer
}

beforeEach(() => vi.clearAllMocks())

test("a socket with no session is closed for good and hears nothing", async () => {
  const peer = await connect(null)
  listUpdates.notify()

  expect(peer.close).toHaveBeenCalledWith(SIGNED_OUT_CLOSE_CODE, "Signed out")
  expect(peer.send).not.toHaveBeenCalled()
})

test("a member's socket from a sibling subdomain is closed as signed out", async () => {
  const peer = await connect(
    { user: { id: "ada" } },
    { origin: "https://evil.example", "sec-fetch-site": "same-site" },
  )
  expect(peer.close).toHaveBeenCalledWith(SIGNED_OUT_CLOSE_CODE, "Signed out")
})

test("a member's socket hears changes until it closes", async () => {
  const peer = await connect({ user: { id: "ada" } })

  listUpdates.notify()
  expect(peer.send).toHaveBeenCalledWith(LISTS_CHANGED)
  listUpdates.notify(LIBRARY_CHANGED)
  expect(peer.send).toHaveBeenCalledWith(LIBRARY_CHANGED)

  hooks.close(peer)
  peer.send.mockClear()
  listUpdates.notify()
  expect(peer.send).not.toHaveBeenCalled()
})

test("a ping gets a pong", async () => {
  const peer = await connect({ user: { id: "ada" } })
  hooks.message(peer, { text: () => PING })
  expect(peer.send).toHaveBeenCalledWith(PONG)
  hooks.close(peer)
})

test("a stopping server hangs up every member's socket", async () => {
  const peer = await connect({ user: { id: "ada" } })
  listUpdates.closeAll()
  expect(peer.close).toHaveBeenCalledWith(
    SERVER_RESTART_CLOSE_CODE,
    SERVER_RESTART_CLOSE_REASON,
  )
  hooks.close(peer)
})
