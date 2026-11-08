// Room wire protocol: plain JSON, no E2E envelope. Hand-written guards, not a
// schema library, to keep cursor parsing cheap and the guest bundle small.

export const ROOM_TOPIC = "room"

/** 4xxx codes reach the page intact; a refused upgrade is an opaque 1006. */
export const ROOM_FULL_CLOSE_CODE = 4029

/** Dead link. The client stops retrying on this code. */
export const LINK_DEAD_CLOSE_CODE = 4010

export const LINK_DEAD_CLOSE_REASON = "Link no longer active"

/**
 * The drawing was trashed. Sent only to members who can see it; the reason is
 * who trashed it, empty on the trasher's own tabs. Final, like a dead link.
 */
export const DRAWING_TRASHED_CLOSE_CODE = 4011

/** The stored scene can't be parsed, so a Room could never save. Also final. */
export const SCENE_UNREADABLE_CLOSE_CODE = 4022

export const SCENE_UNREADABLE_CLOSE_REASON = "Stored scene unreadable"

/** Excalidraw's `Collaborator["color"]` shape. */
export type ParticipantColor = { background: string; stroke: string }

/** `connectionId` is random per socket, never a userId, so nothing leaks to guests. */
export type Participant = {
  connectionId: string
  name: string
  color: ParticipantColor
  isGuest: boolean
  /** A member's SSO profile picture. Null for guests and members without one. */
  image: string | null
}

export type PointerUpdate = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" }
  button: "up" | "down"
  selectedElementIds: Record<string, true>
}

/** Only the merge fields are typed; the rest passes through untouched. */
export type SceneElement = {
  id: string
  version: number
  versionNonce: number
  /** Fractional index. Null on pre-index elements. */
  index?: string | null
  isDeleted?: boolean
  [key: string]: unknown
}

/** Excalidraw's `SceneBounds`, restated so the server needn't import it. */
export type SceneBounds = readonly [number, number, number, number]

export type ClientMessage =
  /** Sent once on open with the guest's stored name. */
  | { type: "JOIN"; payload: { name: string } }
  | { type: "MOUSE_LOCATION"; payload: PointerUpdate }
  /** A delta of changed elements. */
  | { type: "SCENE_UPDATE"; payload: { elements: SceneElement[] } }
  /** Who this tab is following now; null when it stopped. */
  | { type: "USER_FOLLOW"; payload: { followedConnectionId: string | null } }
  /** Sent only while someone is following this tab. */
  | { type: "USER_VISIBLE_SCENE_BOUNDS"; payload: { bounds: SceneBounds } }
  /** Empty payload, so every message has the same shape. */
  | { type: "PING"; payload: Record<string, never> }

export type ServerMessage =
  | {
      type: "ROOM_JOINED"
      payload: { connectionId: string; participants: Participant[] }
    }
  | { type: "PARTICIPANTS"; payload: { participants: Participant[] } }
  | {
      type: "MOUSE_LOCATION"
      payload: PointerUpdate & { connectionId: string }
    }
  /** The Room's whole scene, once per join. */
  | { type: "SCENE_INIT"; payload: { elements: SceneElement[] } }
  /** Changed elements; the Room's copy wherever the incoming one lost. */
  | { type: "SCENE_UPDATE"; payload: { elements: SceneElement[] } }
  /** Who is following this tab. */
  | { type: "FOLLOWED_BY"; payload: { connectionIds: string[] } }
  | {
      type: "USER_VISIBLE_SCENE_BOUNDS"
      payload: { connectionId: string; bounds: SceneBounds }
    }
  /** Keeps traffic flowing both ways for one-way idle timeouts. */
  | { type: "PONG"; payload: Record<string, never> }

/** In code points. */
export const MAX_NAME_LENGTH = 40

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** Clamps a guest's name once here. Null keeps the server's pseudonym. */
export function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") return null
  // Newlines could fake a second UI line.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  if (!trimmed) return null
  return [...trimmed].slice(0, MAX_NAME_LENGTH).join("")
}

function parsePointerUpdate(payload: unknown): PointerUpdate | null {
  if (!isRecord(payload)) return null
  const { pointer, button, selectedElementIds } = payload
  if (!isRecord(pointer)) return null
  if (!isFiniteNumber(pointer.x) || !isFiniteNumber(pointer.y)) return null
  if (pointer.tool !== "pointer" && pointer.tool !== "laser") return null
  if (button !== "up" && button !== "down") return null

  const selected: Record<string, true> = {}
  if (isRecord(selectedElementIds)) {
    for (const id of Object.keys(selectedElementIds)) selected[id] = true
  }
  return {
    pointer: { x: pointer.x, y: pointer.y, tool: pointer.tool },
    button,
    selectedElementIds: selected,
  }
}

function parseSceneBounds(value: unknown): SceneBounds | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  if (!value.every(isFiniteNumber)) return null
  const [x1, y1, x2, y2] = value as number[]
  return [x1, y1, x2, y2]
}

/** Excalidraw elements nest a few levels; Node 22's JSON.stringify overflows near 10k. */
export const MAX_ELEMENT_DEPTH = 64

export function nestedDeeperThan(value: unknown, depth: number): boolean {
  if (typeof value !== "object" || value === null) return false
  if (depth === 0) return true
  return Object.values(value).some((child) =>
    nestedDeeperThan(child, depth - 1),
  )
}

/**
 * What the server must not take from a peer: a version where `+1` stops
 * counting or a negative nonce wins every later merge, and a deep value can't
 * be serialized, so the Room could never save or seat anyone again.
 */
function isSafeFromPeer(element: SceneElement): boolean {
  const { version, versionNonce } = element
  return (
    Number.isSafeInteger(version) &&
    version >= 0 &&
    Number.isSafeInteger(versionNonce) &&
    versionNonce >= 0 &&
    !nestedDeeperThan(element, MAX_ELEMENT_DEPTH)
  )
}

/**
 * Checks only what the merge needs; other fields pass so none are lost. One
 * bad entry rejects all, as a half-applied delta makes a scene no client had.
 */
function parseSceneElements(value: unknown): SceneElement[] | null {
  if (!Array.isArray(value)) return null
  const elements: SceneElement[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const { id, version, versionNonce, index } = entry
    if (typeof id !== "string" || !id) return null
    if (!isFiniteNumber(version) || !isFiniteNumber(versionNonce)) return null
    if (index !== undefined && index !== null && typeof index !== "string")
      return null
    elements.push(entry as SceneElement)
  }
  return elements
}

function parseSceneMessage(payload: Record<string, unknown>) {
  const elements = parseSceneElements(payload.elements)
  return elements === null ? null : { elements }
}

/** Null for anything unrecognized, so garbage or new types are just ignored. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(decoded)) return null

  if (decoded.type === "PING") return { type: "PING", payload: {} }

  if (decoded.type === "JOIN") {
    if (!isRecord(decoded.payload)) return null
    const name = sanitizeName(decoded.payload.name)
    return name === null ? null : { type: "JOIN", payload: { name } }
  }

  if (decoded.type === "MOUSE_LOCATION") {
    const payload = parsePointerUpdate(decoded.payload)
    return payload === null ? null : { type: "MOUSE_LOCATION", payload }
  }

  if (decoded.type === "SCENE_UPDATE") {
    if (!isRecord(decoded.payload)) return null
    const payload = parseSceneMessage(decoded.payload)
    // Server only: the client stays lenient, as the Room may hold an old stored scene.
    if (!payload?.elements.every(isSafeFromPeer)) return null
    return { type: "SCENE_UPDATE", payload }
  }

  if (decoded.type === "USER_FOLLOW") {
    if (!isRecord(decoded.payload)) return null
    const followedConnectionId = decoded.payload.followedConnectionId
    if (
      typeof followedConnectionId !== "string" &&
      followedConnectionId !== null
    )
      return null
    return { type: "USER_FOLLOW", payload: { followedConnectionId } }
  }

  if (decoded.type === "USER_VISIBLE_SCENE_BOUNDS") {
    if (!isRecord(decoded.payload)) return null
    const bounds = parseSceneBounds(decoded.payload.bounds)
    return bounds === null
      ? null
      : { type: "USER_VISIBLE_SCENE_BOUNDS", payload: { bounds } }
  }

  return null
}

function parseParticipants(value: unknown): Participant[] | null {
  if (!Array.isArray(value)) return null
  const participants: Participant[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const { connectionId, name, color, isGuest, image } = entry
    if (typeof connectionId !== "string" || typeof name !== "string")
      return null
    if (!isRecord(color)) return null
    if (
      typeof color.background !== "string" ||
      typeof color.stroke !== "string"
    )
      return null
    participants.push({
      connectionId,
      name,
      color: { background: color.background, stroke: color.stroke },
      isGuest: isGuest === true,
      image: typeof image === "string" ? image : null,
    })
  }
  return participants
}

/** Never throws, so a frame from another build can't crash the canvas. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(decoded)) return null
  if (!isRecord(decoded.payload)) return null
  const payload = decoded.payload

  if (decoded.type === "PONG") return { type: "PONG", payload: {} }

  if (decoded.type === "ROOM_JOINED" || decoded.type === "PARTICIPANTS") {
    const participants = parseParticipants(payload.participants)
    if (!participants) return null
    if (decoded.type === "PARTICIPANTS")
      return { type: "PARTICIPANTS", payload: { participants } }
    if (typeof payload.connectionId !== "string") return null
    return {
      type: "ROOM_JOINED",
      payload: { connectionId: payload.connectionId, participants },
    }
  }

  if (decoded.type === "MOUSE_LOCATION") {
    const pointer = parsePointerUpdate(payload)
    if (!pointer || typeof payload.connectionId !== "string") return null
    return {
      type: "MOUSE_LOCATION",
      payload: { ...pointer, connectionId: payload.connectionId },
    }
  }

  if (decoded.type === "SCENE_INIT" || decoded.type === "SCENE_UPDATE") {
    const scene = parseSceneMessage(payload)
    if (!scene) return null
    return decoded.type === "SCENE_INIT"
      ? { type: "SCENE_INIT", payload: scene }
      : { type: "SCENE_UPDATE", payload: scene }
  }

  if (decoded.type === "FOLLOWED_BY") {
    const { connectionIds } = payload
    if (!Array.isArray(connectionIds)) return null
    if (!connectionIds.every((id) => typeof id === "string")) return null
    return { type: "FOLLOWED_BY", payload: { connectionIds } }
  }

  if (decoded.type === "USER_VISIBLE_SCENE_BOUNDS") {
    const bounds = parseSceneBounds(payload.bounds)
    if (!bounds || typeof payload.connectionId !== "string") return null
    return {
      type: "USER_VISIBLE_SCENE_BOUNDS",
      payload: { connectionId: payload.connectionId, bounds },
    }
  }

  return null
}
