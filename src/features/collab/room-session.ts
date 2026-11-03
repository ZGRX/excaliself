// The Room: who is in a shared drawing and its authoritative scene. Deltas
// merge here first; peers hear the Room's ruling, not the sender's claim.

import { type AccessRow, canAccess } from "@/features/spaces/access"
import {
  SERVER_RESTART_CLOSE_CODE,
  SERVER_RESTART_CLOSE_REASON,
} from "@/lib/socket/shutdown"
import { utf8ByteLength } from "./frame-cap"
import { guestNameForConnection, pickParticipantColor } from "./identity"
import type { Participant, SceneElement, ServerMessage } from "./protocol"
import {
  DRAWING_TRASHED_CLOSE_CODE,
  LINK_DEAD_CLOSE_CODE,
  LINK_DEAD_CLOSE_REASON,
  parseClientMessage,
  ROOM_TOPIC,
  SCENE_UNREADABLE_CLOSE_CODE,
  SCENE_UNREADABLE_CLOSE_REASON,
} from "./protocol"
import { reconcileElements } from "./reconcile"
import type { StoredScene } from "./scene-store"
import { isSyncableElement } from "./scene-sync"

/** The slice of a crossws `Peer` the room logic uses. */
export interface RoomPeer {
  /** Random per socket. */
  readonly id: string
  /** Bytes queued for this socket that it has not read yet. */
  readonly bufferedAmount: number
  send(data: ServerMessage): void
  /** Never echoes to the sender. */
  publish(topic: string, data: ServerMessage): void
  subscribe(topic: string): void
  close(code: number, reason: string): void
}

/** From the upgrade. `userId` and `sessionId` are null for guests. */
export type ParticipantIdentity = {
  userId: string | null
  sessionId: string | null
  displayName: string | null
}

export type SceneLoader = (roomId: string) => Promise<StoredScene>

export type SceneSaver = (
  roomId: string,
  elements: SceneElement[],
) => Promise<void>

/** Trailing write delay; a crash loses at most this much from the db. */
export const ROOM_FLUSH_INTERVAL_MS = 15_000

export type Seat = {
  participant: Participant
  peer: RoomPeer
  /** Kept off `participant`, which goes on the wire. */
  userId: string | null
  /** The session the socket joined with, so revoking it ends the seat. */
  sessionId: string | null
  /** Last frame time, for the ghost sweep. */
  lastSeenAt: number
}

export type Room = {
  /** The drawing id. */
  id: string
  /** Keyed by connection id. */
  seats: Map<string, Seat>
  /** Follower connection id → followed connection id. */
  follows: Map<string, string>
  loaded: Promise<void>
  elements: SceneElement[]
  /** Serialized size of `elements`, for the scene cap. */
  bytes: number
  /** Cached for the live badge and the reserved seat; null until loaded. */
  access: AccessRow | null
  dirty: boolean
  flushTimer: ReturnType<typeof setTimeout> | null
  /** The write in flight; overlapping flushes chain onto it. */
  flushing: Promise<void>
}

/** One Room per drawing, in-memory per process. */
export type RoomRegistry = {
  rooms: Map<string, Room>
  loadScene: SceneLoader
  saveScene: SceneSaver
  /** Injected for the ghost sweep. */
  now: () => number
  /** Set on shutdown: joins are refused from then on. */
  closing: boolean
}

export function createRoomRegistry(
  loadScene: SceneLoader,
  saveScene: SceneSaver,
  now: () => number = () => Date.now(),
): RoomRegistry {
  return {
    rooms: new Map(),
    loadScene,
    saveScene,
    now,
    closing: false,
  }
}

/** Lazy. Concurrent joins share one load promise rather than racing. */
function ensureRoom(registry: RoomRegistry, roomId: string): Room {
  const existing = registry.rooms.get(roomId)
  if (existing) return existing

  const room: Room = {
    id: roomId,
    seats: new Map(),
    follows: new Map(),
    loaded: Promise.resolve(),
    elements: [],
    bytes: 0,
    access: null,
    dirty: false,
    flushTimer: null,
    flushing: Promise.resolve(),
  }
  registry.rooms.set(roomId, room)

  // Drops the Room and hangs up on everyone seated while it loaded.
  const abandon = (code: number, reason: string) => {
    if (registry.rooms.get(roomId) === room) registry.rooms.delete(roomId)
    const seats = [...room.seats.values()]
    room.seats.clear()
    room.follows.clear()
    for (const { peer } of seats) peer.close(code, reason)
  }

  room.loaded = registry.loadScene(roomId).then(
    (stored) => {
      // Unreadable JSON would open empty and could never be written back, so
      // every edit in it would be lost. No Room at all instead.
      if (!stored.readable)
        return abandon(
          SCENE_UNREADABLE_CLOSE_CODE,
          SCENE_UNREADABLE_CLOSE_REASON,
        )
      room.elements = stored.elements
      room.bytes = sceneBytes(stored.elements)
      room.access = stored.access
    },
    (error) => {
      // Clients reconnect into a fresh read.
      console.error(`[collab] could not load scene for room ${roomId}`, error)
      abandon(1011, "Scene unavailable")
    },
  )
  return room
}

function disarmFlush(room: Room) {
  if (room.flushTimer === null) return
  clearTimeout(room.flushTimer)
  room.flushTimer = null
}

/** Drops an empty, written Room. Also runs after writes: a leave can race one. */
function reapIfIdle(registry: RoomRegistry, room: Room) {
  if (room.seats.size > 0 || room.dirty) return
  if (registry.rooms.get(room.id) !== room) return
  disarmFlush(room)
  registry.rooms.delete(room.id)
}

function armFlush(registry: RoomRegistry, room: Room) {
  if (room.flushTimer !== null) return
  room.flushTimer = setTimeout(() => {
    room.flushTimer = null
    void flushRoom(registry, room)
  }, ROOM_FLUSH_INTERVAL_MS)
}

function markDirty(registry: RoomRegistry, room: Room) {
  room.dirty = true
  armFlush(registry, room)
}

/** A failed query's message lists its params, which is the whole scene. */
function errorCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined
  if (typeof cause === "object" && cause !== null && "code" in cause)
    return String(cause.code)
  return error instanceof Error ? error.name : String(error)
}

/**
 * Writes now if dirty; resolves once landed. Chained on `flushing`, so two
 * read-modify-writes never race and the older one can't land last.
 */
function flushRoom(registry: RoomRegistry, room: Room): Promise<void> {
  disarmFlush(room)
  if (!room.dirty) return room.flushing

  room.dirty = false
  room.flushing = room.flushing.then(() =>
    // Read inside the chain, so merges during an earlier write ride along.
    registry.saveScene(room.id, room.elements).then(
      () => {
        reapIfIdle(registry, room)
      },
      (error) => {
        // Still in memory: retry on the throttle. An empty Room stays until it lands.
        console.error(
          `[collab] could not flush room ${room.id}`,
          errorCode(error),
        )
        room.dirty = true
        armFlush(registry, room)
      },
    ),
  )
  return room.flushing
}

/**
 * Shutdown: refuse joins, then end every Room. Edits after the final write
 * are refused, so they stay on the client and are re-sent after the restart.
 */
export async function closeAllRooms(registry: RoomRegistry): Promise<void> {
  registry.closing = true
  await Promise.all(
    [...registry.rooms.keys()].map((roomId) =>
      endRoom(registry, roomId, ({ peer }) =>
        peer.close(SERVER_RESTART_CLOSE_CODE, SERVER_RESTART_CLOSE_REASON),
      ),
    ),
  )
}

/**
 * A seat this far behind, past one full scene still on its way, has stopped
 * reading. Closing it caps what we hold for it.
 */
export const MAX_SEAT_BUFFERED_BYTES = 8 * 1024 * 1024

/** Fans out to every other seat, then hangs up on seats too far behind. */
function publish(room: Room, peer: RoomPeer, message: ServerMessage) {
  peer.publish(ROOM_TOPIC, message)
  const limit = room.bytes + MAX_SEAT_BUFFERED_BYTES
  for (const seat of room.seats.values())
    if (seat.peer.bufferedAmount > limit) closeToRejoin(seat.peer)
}

function rosterOf(room: Room): Participant[] {
  return [...room.seats.values()].map((seat) => seat.participant)
}

const rosterMessage = (room: Room): ServerMessage => ({
  type: "PARTICIPANTS",
  payload: { participants: rosterOf(room) },
})

function broadcastRoster(peer: RoomPeer, room: Room) {
  const message = rosterMessage(room)
  peer.send(message)
  publish(room, peer, message)
}

/** Stops a script holding sockets open, not real sessions. The last seat is the owner's. */
export const MAX_ROOM_PARTICIPANTS = 25

/** About 3.5 missed heartbeats. */
export const PARTICIPANT_IDLE_TIMEOUT_MS = 90_000

/** How often `sweepSilentParticipants` runs. */
export const PARTICIPANT_SWEEP_INTERVAL_MS = 30_000

/** Drops seats silent past the timeout; returns their peers to close. */
function forgetSilentParticipants(room: Room, now: number): RoomPeer[] {
  const silent: RoomPeer[] = []
  for (const [connectionId, seat] of room.seats) {
    if (now - seat.lastSeenAt < PARTICIPANT_IDLE_TIMEOUT_MS) continue
    forgetConnection(room, connectionId)
    silent.push(seat.peer)
  }
  return silent
}

/** Matches the ws route's eviction close, so a live client rejoins. */
const closeToRejoin = (peer: RoomPeer) => peer.close(1000, "Rejoin")

/**
 * Ghost seats (a socket that died without a close) would hold a seat, the
 * roster and the live badge. Runs on a timer, so nobody has to join first.
 */
export async function sweepSilentParticipants(
  registry: RoomRegistry,
): Promise<void> {
  const now = registry.now()
  await Promise.all(
    [...registry.rooms.values()].map(async (room) => {
      const silent = forgetSilentParticipants(room, now)
      if (silent.length === 0) return
      await settleAfterForget(registry, room)
      for (const peer of silent) closeToRejoin(peer)
    }),
  )
}

/**
 * After seats were dropped without their own close: last-leave if empty,
 * else the new roster. Sent, not published: the dropped peers can't fan out.
 */
async function settleAfterForget(registry: RoomRegistry, room: Room) {
  if (room.seats.size === 0) {
    await flushRoom(registry, room)
    reapIfIdle(registry, room)
    return
  }
  const message = rosterMessage(room)
  for (const { peer } of room.seats.values()) peer.send(message)
}

function forgetConnection(room: Room, connectionId: string) {
  room.seats.delete(connectionId)

  const wasFollowing = room.follows.get(connectionId) ?? null
  room.follows.delete(connectionId)
  for (const follower of followersOf(room, connectionId))
    room.follows.delete(follower)
  if (wasFollowing) sendFollowedBy(room, wasFollowing)
}

export type RoomJoinResult =
  | { status: "ok" }
  | { status: "full" }
  | { status: "closing" }

export async function joinRoom(
  registry: RoomRegistry,
  roomId: string,
  peer: RoomPeer,
  identity: ParticipantIdentity,
): Promise<RoomJoinResult> {
  // A Room made now would never get its final write.
  if (registry.closing) return { status: "closing" }

  // Before `ensureRoom`, so a refused join creates no Room and no read.
  const existing = registry.rooms.get(roomId)
  if (existing) {
    // Also swept on join, so a full Room never waits on the timer. The
    // joiner's own roster publish tells the others.
    const silent = forgetSilentParticipants(existing, registry.now())
    for (const peer of silent) closeToRejoin(peer)
    // Everyone else stops one short, so guests can't lock out a member who
    // can access the drawing (for a Private one, its creator).
    const hasAccess =
      identity.userId !== null &&
      existing.access !== null &&
      canAccess(existing.access, identity.userId)
    const cap = hasAccess ? MAX_ROOM_PARTICIPANTS : MAX_ROOM_PARTICIPANTS - 1
    if (existing.seats.size >= cap) {
      // No joiner publish follows, so tell the others here.
      if (silent.length > 0) await settleAfterForget(registry, existing)
      return { status: "full" }
    }
  }

  const room = ensureRoom(registry, roomId)

  const isGuest = identity.userId === null
  const participant: Participant = {
    connectionId: peer.id,
    // A guest wears a pseudonym until its JOIN arrives.
    name: identity.displayName?.trim() || guestNameForConnection(peer.id),
    color: pickParticipantColor(rosterOf(room).map((p) => p.color)),
    isGuest,
  }
  room.seats.set(peer.id, {
    participant,
    peer,
    userId: identity.userId,
    sessionId: identity.sessionId,
    lastSeenAt: registry.now(),
  })

  peer.subscribe(ROOM_TOPIC)
  // Presence before the scene read, so avatars never wait on the db.
  peer.send({
    type: "ROOM_JOINED",
    payload: { connectionId: peer.id, participants: rosterOf(room) },
  })
  publish(room, peer, rosterMessage(room))

  await room.loaded
  if (room.seats.has(peer.id)) {
    // The Room keeps stale tombstones to correct tabs with a pre-delete
    // copy; a joiner never needs them.
    const now = registry.now()
    const elements = room.elements.filter((el) => isSyncableElement(el, now))
    peer.send({ type: "SCENE_INIT", payload: { elements } })
  }
  return { status: "ok" }
}

const followersOf = (room: Room, followedId: string) =>
  [...room.follows.entries()]
    .filter(([, followed]) => followed === followedId)
    .map(([follower]) => follower)

/** Everyone up this peer's follow chain, so a ring A→B→C→A never loops bounds. */
function upstreamOf(room: Room, peerId: string): Set<string> {
  const upstream = new Set<string>()
  let cursor = room.follows.get(peerId)
  while (cursor && !upstream.has(cursor)) {
    upstream.add(cursor)
    cursor = room.follows.get(cursor)
  }
  return upstream
}

/** A peer relays its viewport only while this list is non-empty. */
function sendFollowedBy(room: Room, followedId: string) {
  room.seats.get(followedId)?.peer.send({
    type: "FOLLOWED_BY",
    payload: { connectionIds: followersOf(room, followedId) },
  })
}

function setFollowTarget(
  room: Room,
  followerId: string,
  target: string | null,
) {
  // Self or absent targets mean "nobody", so clients can't plant bad entries.
  const followed =
    target && target !== followerId && room.seats.has(target) ? target : null
  const previous = room.follows.get(followerId) ?? null
  if (previous === followed) return

  if (followed) room.follows.set(followerId, followed)
  else room.follows.delete(followerId)

  if (previous) sendFollowedBy(room, previous)
  if (followed) sendFollowedBy(room, followed)
}

/**
 * Far more edits than one element gets between syncs. A bigger jump could
 * only come from a forged frame that wants to win every later merge. A new
 * id counts from the Room's newest version, as a duplicate keeps its source's.
 */
const MAX_VERSION_JUMP = 2 ** 20

/**
 * Past either cap, a delta that grows the scene is refused whole, unheard.
 * No close: the client would rejoin and resend it. Edits that don't grow
 * the scene still merge.
 */
export const MAX_ROOM_ELEMENTS = 50_000
export const MAX_ROOM_SCENE_BYTES = 20 * 1024 * 1024

/** UTF-8 JSON size per element. Elements are kept by reference, so each is measured once. */
const elementBytes = new WeakMap<SceneElement, number>()

function bytesOf(element: SceneElement): number {
  let bytes = elementBytes.get(element)
  if (bytes === undefined) {
    bytes = utf8ByteLength(JSON.stringify(element))
    elementBytes.set(element, bytes)
  }
  return bytes
}

const sceneBytes = (elements: SceneElement[]) =>
  elements.reduce((total, el) => total + bytesOf(el), 0)

/**
 * Merges a delta; others get the winners, the sender only its corrections.
 * Stale tombstones go only to a sender who can open the drawing: others
 * never got them, and a guest must not read older deletions. Returns
 * whether the scene changed, by identity: a version sum misses nonce
 * tie-breaks.
 */
function applySceneUpdate(
  room: Room,
  peer: RoomPeer,
  delta: SceneElement[],
  now: number,
): boolean {
  const previous = room.elements
  const previousById = new Map(previous.map((el) => [el.id, el]))
  const newest = previous.reduce((max, el) => Math.max(max, el.version), 0)
  const incoming = delta.filter(
    (el) =>
      el.version <=
      (previousById.get(el.id)?.version ?? newest) + MAX_VERSION_JUMP,
  )
  const merged = reconcileElements(previous, incoming, {})
  let bytes = room.bytes
  let changed = merged.length !== previous.length
  for (const el of merged) {
    const before = previousById.get(el.id)
    if (before === el) continue
    changed = true
    bytes += bytesOf(el) - (before ? bytesOf(before) : 0)
  }
  const grows = merged.length > previous.length || bytes > room.bytes
  if (
    grows &&
    (merged.length > MAX_ROOM_ELEMENTS || bytes > MAX_ROOM_SCENE_BYTES)
  )
    return false
  room.elements = merged
  room.bytes = bytes

  // Winners are kept by reference, so `winner !== element` means it lost.
  const authoritative = new Map(room.elements.map((el) => [el.id, el]))
  const winners: SceneElement[] = []
  const corrections: SceneElement[] = []
  const seen = new Set<string>()
  for (const element of incoming) {
    if (seen.has(element.id)) continue
    seen.add(element.id)
    const winner = authoritative.get(element.id) ?? element
    winners.push(winner)
    if (winner !== element) corrections.push(winner)
  }

  const published = winners.filter((el) => isSyncableElement(el, now))
  if (published.length)
    publish(room, peer, {
      type: "SCENE_UPDATE",
      payload: { elements: published },
    })
  const userId = room.seats.get(peer.id)?.userId ?? null
  const seesStale =
    userId !== null && room.access !== null && canAccess(room.access, userId)
  const corrected = seesStale
    ? corrections
    : corrections.filter((el) => isSyncableElement(el, now))
  if (corrected.length)
    peer.send({ type: "SCENE_UPDATE", payload: { elements: corrected } })

  return changed
}

/** `evicted`: the seat is gone, so the transport must close to make it rejoin. */
export type FrameOutcome = "ok" | "evicted"

export async function receiveFromPeer(
  registry: RoomRegistry,
  roomId: string,
  peer: RoomPeer,
  raw: string,
): Promise<FrameOutcome> {
  const message = parseClientMessage(raw)
  if (!message) return "ok"

  const room = registry.rooms.get(roomId)
  // Not an eviction: the close hook tidies this up.
  if (!room) return "ok"

  const seat = room.seats.get(peer.id)
  if (!seat) return "evicted"

  // Any frame is proof of life.
  seat.lastSeenAt = registry.now()

  switch (message.type) {
    case "PING":
      // Only seated peers get a PONG, so an evicted client never looks healthy.
      peer.send({ type: "PONG", payload: {} })
      return "ok"

    case "JOIN": {
      // Only guests name themselves.
      const { participant } = seat
      if (!participant.isGuest || participant.name === message.payload.name)
        return "ok"
      seat.participant = { ...participant, name: message.payload.name }
      broadcastRoster(peer, room)
      return "ok"
    }

    case "USER_FOLLOW":
      setFollowTarget(room, peer.id, message.payload.followedConnectionId)
      return "ok"

    case "USER_VISIBLE_SCENE_BOUNDS": {
      const upstream = upstreamOf(room, peer.id)
      for (const followerId of followersOf(room, peer.id)) {
        if (upstream.has(followerId)) continue
        room.seats.get(followerId)?.peer.send({
          type: "USER_VISIBLE_SCENE_BOUNDS",
          payload: { connectionId: peer.id, bounds: message.payload.bounds },
        })
      }
      return "ok"
    }

    case "SCENE_UPDATE":
      // Wait for the stored scene, or the merge would drop it.
      await room.loaded
      if (!room.seats.has(peer.id)) return "evicted"
      if (
        applySceneUpdate(room, peer, message.payload.elements, registry.now())
      )
        markDirty(registry, room)
      return "ok"

    case "MOUSE_LOCATION":
      publish(room, peer, {
        type: "MOUSE_LOCATION",
        payload: { ...message.payload, connectionId: peer.id },
      })
      return "ok"

    default:
      return message satisfies never
  }
}

export async function leaveRoom(
  registry: RoomRegistry,
  roomId: string,
  peer: RoomPeer,
) {
  const room = registry.rooms.get(roomId)
  if (!room?.seats.has(peer.id)) return
  forgetConnection(room, peer.id)

  // Last one out writes first. `reapIfIdle` keeps the Room on a rejoin or retry.
  if (room.seats.size === 0) {
    await flushRoom(registry, room)
    reapIfIdle(registry, room)
    return
  }
  publish(room, peer, rosterMessage(room))
}

// --- link lifecycle ---

const closeAsDead = (peer: RoomPeer) =>
  peer.close(LINK_DEAD_CLOSE_CODE, LINK_DEAD_CLOSE_REASON)

/**
 * Stop, regenerate and member deletion end here: freeze, write, then hang up.
 * The awaited write lets the owner resume autosave once the mutation resolves.
 */
export function terminateRoom(
  registry: RoomRegistry,
  roomId: string,
): Promise<void> {
  return endRoom(registry, roomId, ({ peer }) => closeAsDead(peer))
}

/** Close reasons are capped at 123 UTF-8 bytes. */
const MAX_CLOSE_REASON_BYTES = 123

/** Cuts whole code points, so a long name never splits a character. */
function toCloseReason(text: string): string {
  const encoder = new TextEncoder()
  let reason = ""
  let bytes = 0
  for (const char of text) {
    bytes += encoder.encode(char).length
    if (bytes > MAX_CLOSE_REASON_BYTES) break
    reason += char
  }
  return reason
}

/**
 * The drawing was trashed: ends its Room like `terminateRoom`. Members who can
 * see the drawing learn who trashed it; everyone else gets the dead-link close,
 * so nothing reaches a guest.
 */
export function trashRoom(
  registry: RoomRegistry,
  roomId: string,
  trasher: { userId: string; name: string },
): Promise<void> {
  const reason = toCloseReason(trasher.name)
  return endRoom(registry, roomId, ({ peer, userId }, access) => {
    if (userId === null || !access || !canAccess(access, userId))
      return closeAsDead(peer)
    // The trasher's own tabs need no name.
    peer.close(
      DRAWING_TRASHED_CLOSE_CODE,
      userId === trasher.userId ? "" : reason,
    )
  })
}

/**
 * A Share link stopped or regenerated. A Private drawing's Room ends with it;
 * a Team drawing's Room needs no link, so only its guests go.
 */
export async function endLinkRoom(
  registry: RoomRegistry,
  roomId: string,
): Promise<void> {
  const room = registry.rooms.get(roomId)
  if (!room) return
  // `access` is read once the scene has loaded.
  await room.loaded
  if (room.access?.space === "team") return evictNonMembers(registry, roomId)
  return terminateRoom(registry, roomId)
}

/**
 * The drawing moved to Team. Its Room, if live, keeps every seat; only the
 * cached access changes, so the Live badge, the seat cap and later link
 * changes treat it as Team.
 */
export async function moveRoomToTeam(
  registry: RoomRegistry,
  roomId: string,
): Promise<void> {
  const room = registry.rooms.get(roomId)
  if (!room) return
  await room.loaded
  if (room.access) room.access = { ...room.access, space: "team" }
}

/**
 * The live scene of a drawing's Room, newer than the stored one. Null when no
 * Room is open, or when it failed to load: that drops it from the registry.
 */
export async function roomElements(
  registry: RoomRegistry,
  roomId: string,
): Promise<SceneElement[] | null> {
  const room = registry.rooms.get(roomId)
  if (!room) return null
  await room.loaded
  return registry.rooms.get(roomId) === room ? room.elements : null
}

/** Freeze, write, then hang up each seat with `hangUp`. */
async function endRoom(
  registry: RoomRegistry,
  roomId: string,
  hangUp: (seat: Seat, access: AccessRow | null) => void,
): Promise<void> {
  const room = registry.rooms.get(roomId)
  if (!room) return

  // Queue behind edits still waiting on the load, so the flush carries them.
  await room.loaded

  // Clear seats before the flush: that freezes the scene the write sees.
  // Peers are captured first, so their close hooks find nothing to flush.
  const seats = [...room.seats.values()]
  room.seats.clear()
  room.follows.clear()

  await flushRoom(registry, room)
  reapIfIdle(registry, room)

  for (const seat of seats) hangUp(seat, room.access)
}

/**
 * Closes guest sockets when a link tightens to members. Reads `seat.userId`
 * from the upgrade, never the wire-facing `isGuest`.
 */
export async function evictNonMembers(
  registry: RoomRegistry,
  roomId: string,
): Promise<void> {
  const room = registry.rooms.get(roomId)
  if (!room) return

  // As in `terminateRoom`: let queued strokes merge first.
  await room.loaded

  await evictSeats(registry, room, (seat) => seat.userId === null)
}

/**
 * A member was deleted: closes their seats in every Room at once. Their
 * queued frames then find no seat, so nothing they send is merged.
 */
export async function evictUser(
  registry: RoomRegistry,
  userId: string,
): Promise<void> {
  await Promise.all(
    [...registry.rooms.values()].map((room) =>
      evictSeats(registry, room, (seat) => seat.userId === userId),
    ),
  )
}

/**
 * Sessions ended: closes the seats that joined with them. They rejoin, and
 * the join checks the session again.
 */
export async function evictSessions(
  registry: RoomRegistry,
  sessionIds: ReadonlySet<string>,
): Promise<void> {
  await Promise.all(
    [...registry.rooms.values()].map((room) =>
      evictSeats(
        registry,
        room,
        (seat) => seat.sessionId !== null && sessionIds.has(seat.sessionId),
        closeToRejoin,
      ),
    ),
  )
}

/** Drops the picked seats, settles the Room, then hangs up on them. */
async function evictSeats(
  registry: RoomRegistry,
  room: Room,
  pick: (seat: Seat) => boolean,
  hangUp: (peer: RoomPeer) => void = closeAsDead,
) {
  const evicted: RoomPeer[] = []
  for (const [connectionId, seat] of [...room.seats]) {
    if (!pick(seat)) continue
    forgetConnection(room, connectionId)
    evicted.push(seat.peer)
  }
  if (evicted.length === 0) return

  await settleAfterForget(registry, room)
  for (const peer of evicted) hangUp(peer)
}
