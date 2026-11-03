import { expect, test, vi } from "vitest"
import { INBOUND_FRAME_BURST } from "@/features/collab/inbound-budget"
import {
  FAILED_TOKEN_LOOKUPS_PER_MINUTE,
  recordFailedTokenLookup,
} from "@/features/shares/token-rate-limit"
import type { RoomJoin } from "./room-token"

// Hand back the hooks themselves, so a test can call `upgrade` directly.
vi.mock("nitro", () => ({ defineWebSocketHandler: (hooks: unknown) => hooks }))
vi.mock("./room-registry", () => ({ rooms: {} }))
vi.mock("@/env", () => ({ env: {} }))
const receiveFromPeer = vi.hoisted(() => vi.fn(async () => "ok"))
vi.mock("./room-session", async (original) => ({
  ...(await original()),
  receiveFromPeer,
}))

const { defineRoomSocket } = await import("./room-socket")

type Upgrade = { upgrade(request: Request): Promise<unknown> }
type Message = {
  message(
    peer: unknown,
    message: { rawData: string; text(): string },
  ): Promise<void>
}

const socket = (join: RoomJoin, limitFailures: boolean) =>
  defineRoomSocket(async () => join, { limitFailures }) as unknown as Upgrade

const admitted: RoomJoin = {
  status: "ok",
  roomId: "drawing-1",
  identity: { userId: "user-1", sessionId: "session-1", displayName: "Ada" },
}
const refused: RoomJoin = { status: "refused" }

// The token budget is process-wide, so each test uses an IP of its own.
const from = (ip: string) =>
  new Request("http://app.test/ws/x", {
    headers: { "x-forwarded-for": ip },
  })

const knock = async (entry: Upgrade, ip: string, times: number) => {
  for (let i = 0; i < times; i++) await entry.upgrade(from(ip))
}

test("refused by-id joins never lock out share links from the same IP", async () => {
  const ip = "203.0.113.30"
  await knock(socket(refused, false), ip, FAILED_TOKEN_LOOKUPS_PER_MINUTE * 2)

  await expect(socket(admitted, true).upgrade(from(ip))).resolves.toEqual(
    expect.objectContaining({ namespace: "room:drawing-1" }),
  )
})

test("a by-id join still works while its IP is out of token budget", async () => {
  const ip = "203.0.113.31"
  const visitor = { headers: from(ip).headers }
  for (let i = 0; i < FAILED_TOKEN_LOOKUPS_PER_MINUTE; i++)
    recordFailedTokenLookup(visitor)

  await expect(socket(admitted, false).upgrade(from(ip))).resolves.toEqual(
    expect.objectContaining({ namespace: "room:drawing-1" }),
  )
})

test("refused token joins still spend the budget", async () => {
  const ip = "203.0.113.32"
  await knock(socket(refused, true), ip, FAILED_TOKEN_LOOKUPS_PER_MINUTE)

  await expect(socket(admitted, true).upgrade(from(ip))).rejects.toMatchObject({
    status: 429,
  })
})

test("a sibling-subdomain page is refused, so open closes it as a dead link", async () => {
  const sibling = new Request("http://app.test/ws/drawings/drawing-1", {
    headers: { origin: "https://evil.example", "sec-fetch-site": "same-site" },
  })
  await expect(socket(admitted, false).upgrade(sibling)).resolves.toBe(
    undefined,
  )
})

test("frames past a socket's budget are dropped unread", async () => {
  vi.useFakeTimers()
  const entry = socket(admitted, false) as unknown as Message
  const peer = {
    context: { roomId: "drawing-1", identity: admitted },
    close: vi.fn(),
  }
  const ping = '{"type":"PING","payload":{}}'

  for (let i = 0; i < INBOUND_FRAME_BURST + 5; i++)
    await entry.message(peer, { rawData: ping, text: () => ping })

  expect(receiveFromPeer).toHaveBeenCalledTimes(INBOUND_FRAME_BURST)
  expect(peer.close).not.toHaveBeenCalled()
  vi.useRealTimers()
})
