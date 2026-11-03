// The room websocket, shared by both entries under `server/routes/ws/`: a
// Share link's token and a Team Drawing's id. Thin on purpose.

import { defineWebSocketHandler } from "nitro"
import {
  exceedsFrameCap,
  FRAME_TOO_LARGE_CLOSE_CODE,
} from "@/features/collab/frame-cap"
import {
  createInboundBudget,
  type InboundBudget,
} from "@/features/collab/inbound-budget"
import {
  LINK_DEAD_CLOSE_CODE,
  LINK_DEAD_CLOSE_REASON,
  ROOM_FULL_CLOSE_CODE,
} from "@/features/collab/protocol"
import { rooms } from "@/features/collab/room-registry"
import type { ParticipantIdentity } from "@/features/collab/room-session"
import {
  joinRoom,
  leaveRoom,
  receiveFromPeer,
} from "@/features/collab/room-session"
import type { RoomJoin } from "@/features/collab/room-token"
import { spendFailedTokenLookup } from "@/features/shares/token-rate-limit"
import { socketIpOf } from "@/lib/client-ip"
import { fromOwnOrigin } from "@/lib/same-origin"
import {
  SERVER_RESTART_CLOSE_CODE,
  SERVER_RESTART_CLOSE_REASON,
} from "@/lib/socket/shutdown"

/** Keyed by drawing, not crossws's default pathname, so a new token keeps the room. */
const namespaceFor = (roomId: string) => `room:${roomId}`

/**
 * Nitro's route params don't reach ws hooks. Tokens are hex and drawing ids
 * UUIDs, so no decoding.
 */
export const lastPathSegment = (request: Request) =>
  new URL(request.url).pathname.split("/").pop() || ""

/** Per socket; dies with its peer. */
const budgets = new WeakMap<object, InboundBudget>()

function roomContextOf(peer: { context: Record<string, unknown> }) {
  const { roomId, identity } = peer.context as Partial<{
    roomId: string
    identity: ParticipantIdentity
  }>
  return roomId && identity ? { roomId, identity } : null
}

/**
 * `resolve` admits or refuses a socket. It runs on the upgrade and again once
 * the socket is seated, and refuses every failure alike. `limitFailures` puts
 * the entry under the token-guessing budget; by-id joins need a session, so
 * guessing ids gains nothing and their refusals must not block share links.
 */
export const defineRoomSocket = (
  resolve: (request: Request) => Promise<RoomJoin>,
  { limitFailures }: { limitFailures: boolean },
) =>
  defineWebSocketHandler({
    async upgrade(request) {
      // Refused like a dead link (see below), and not a token guess.
      if (!fromOwnOrigin(request)) return

      // Runs on every (re)connect, so link changes apply on the next join.
      const join = await resolve(request)
      if (join.status !== "ok") {
        if (
          limitFailures &&
          !spendFailedTokenLookup({
            headers: request.headers,
            socketIp: socketIpOf(request),
          })
        )
          throw new Response("Too Many Requests", { status: 429 })
        // Accept and close in `open`: a refused handshake is an opaque 1006
        // the client can't tell from an outage, so it would retry forever.
        return
      }

      return {
        namespace: namespaceFor(join.roomId),
        context: {
          roomId: join.roomId,
          identity: join.identity,
        },
      }
    },

    // Frames keep their order: all queue behind the same Room load promise.
    async open(peer) {
      // The one close the client's reconnect loop treats as final.
      const context = roomContextOf(peer)
      if (!context)
        return peer.close(LINK_DEAD_CLOSE_CODE, LINK_DEAD_CLOSE_REASON)

      // Seat first, then check access again. Access lost during the
      // handshake (a dead link, a trash) either fails this check or finds the
      // seat to evict.
      const joining = joinRoom(rooms, context.roomId, peer, context.identity)
      const recheck = await resolve(peer.request)
      if (recheck.status !== "ok" || recheck.roomId !== context.roomId) {
        await leaveRoom(rooms, context.roomId, peer)
        return peer.close(LINK_DEAD_CLOSE_CODE, LINK_DEAD_CLOSE_REASON)
      }
      // The cap is checked here, not at the upgrade: a refused handshake
      // reaches the browser as an opaque 1006.
      const { status } = await joining
      if (status === "full") peer.close(ROOM_FULL_CLOSE_CODE, "Room full")
      if (status === "closing")
        peer.close(SERVER_RESTART_CLOSE_CODE, SERVER_RESTART_CLOSE_REASON)
    },

    async message(peer, message) {
      const context = roomContextOf(peer)
      if (!context) return

      // Raw frame, so it isn't decoded too. The build sets ws `maxPayload` to
      // the same cap (vite.config.ts), so ws refuses first; this is the fallback.
      if (exceedsFrameCap(message.rawData))
        return peer.close(FRAME_TOO_LARGE_CLOSE_CODE, "Frame too large")

      // Over budget, frames are dropped unread. The client's next full sync
      // heals a dropped edit; closing would only hand it a fresh budget.
      const text = message.text()
      const now = Date.now()
      const budget = budgets.get(peer) ?? createInboundBudget(now)
      budgets.set(peer, budget)
      if (!budget.spend(Buffer.byteLength(text), now)) return

      const outcome = await receiveFromPeer(rooms, context.roomId, peer, text)
      // Seat swept while the socket stayed open: close so the client rejoins.
      if (outcome === "evicted") peer.close(1000, "Rejoin")
    },

    // The last one out waits for the Room's final write.
    async close(peer) {
      const context = roomContextOf(peer)
      if (!context) return
      await leaveRoom(rooms, context.roomId, peer)
    },
  })
