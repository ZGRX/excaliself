import { expect, test, vi } from "vitest"
import type { AccessRow } from "@/features/spaces/access"
import { SERVER_RESTART_CLOSE_CODE } from "@/lib/socket/shutdown"
import { guestNameForConnection } from "./identity"
import type { SceneElement, ServerMessage } from "./protocol"
import {
  DRAWING_TRASHED_CLOSE_CODE,
  LINK_DEAD_CLOSE_CODE,
  ROOM_TOPIC,
  SCENE_UNREADABLE_CLOSE_CODE,
  SCENE_UNREADABLE_CLOSE_REASON,
} from "./protocol"
import {
  closeAllRooms,
  createRoomRegistry,
  endLinkRoom,
  evictNonMembers,
  evictUser,
  joinRoom,
  leaveRoom,
  MAX_ROOM_PARTICIPANTS,
  moveRoomToTeam,
  PARTICIPANT_IDLE_TIMEOUT_MS,
  ROOM_FLUSH_INTERVAL_MS,
  type RoomPeer,
  type RoomRegistry,
  receiveFromPeer,
  roomElements,
  type SceneLoader,
  type SceneSaver,
  sweepSilentParticipants,
  terminateRoom,
  trashRoom,
} from "./room-session"

const ROOM = "drawing-1"

/** Stands in for a crossws Peer: records what it was sent and what it fanned out. */
function fakePeer(id: string) {
  const sent: ServerMessage[] = []
  const published: { topic: string; data: ServerMessage }[] = []
  const topics: string[] = []
  const closes: { code: number; reason: string }[] = []
  const peer: RoomPeer & {
    sent: ServerMessage[]
    published: typeof published
    topics: string[]
    closes: typeof closes
  } = {
    id,
    sent,
    published,
    topics,
    closes,
    send: (data) => {
      sent.push(data)
    },
    publish: (topic, data) => {
      published.push({ topic, data })
    },
    subscribe: (topic) => {
      topics.push(topic)
    },
    close: (code, reason) => {
      closes.push({ code, reason })
    },
  }
  return peer
}

/**
 * A registry whose saver is a no-op — the default for everything that isn't
 * about persistence. The flush tests below build their own with a recording
 * saver.
 */
const registryFrom = (load: SceneLoader, save: SceneSaver = async () => {}) =>
  createRoomRegistry(load, save)

/** A registry over an empty stored drawing — the presence tests' default. */
const emptyRegistry = (load?: SceneLoader) =>
  registryFrom(
    load ?? (async () => ({ elements: [], access: null, readable: true })),
  )

const member = (displayName: string) => ({
  userId: `u:${displayName}`,
  sessionId: `s:${displayName}`,
  displayName,
})
const guest = { userId: null, sessionId: null, displayName: null }

const rosterOf = (message: ServerMessage | undefined) =>
  message && "participants" in message.payload
    ? message.payload.participants.map((p) => p.name)
    : undefined

const framesOf = (peer: ReturnType<typeof fakePeer>, type: string) =>
  peer.sent.filter((message) => message.type === type)

const elementsOf = (message: ServerMessage | undefined) =>
  message && "elements" in message.payload
    ? message.payload.elements
    : undefined

function element(
  id: string,
  version: number,
  extra: Partial<SceneElement> = {},
): SceneElement {
  return { id, version, versionNonce: 1, index: "a0", ...extra }
}

const sceneUpdate = (elements: SceneElement[]) =>
  JSON.stringify({ type: "SCENE_UPDATE", payload: { elements } })

test("the joiner learns its own connection id and the room it walked into", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  expect(ada.topics).toEqual([ROOM_TOPIC])
  expect(ada.sent[0]).toMatchObject({
    type: "ROOM_JOINED",
    payload: { connectionId: "peer-ada" },
  })
  expect(rosterOf(ada.sent[0])).toEqual(["Ada"])
})

test("a second peer sees the first, and the first is told about the second", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, member("Grace"))

  expect(rosterOf(grace.sent[0])).toEqual(["Ada", "Grace"])
  // Grace's join fans the new roster out to everyone else in the room.
  expect(grace.published).toHaveLength(1)
  expect(grace.published[0].topic).toBe(ROOM_TOPIC)
  expect(grace.published[0].data.type).toBe("PARTICIPANTS")
  expect(rosterOf(grace.published[0].data)).toEqual(["Ada", "Grace"])
})

test("members arrive under their display name; guests under a pseudonym", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  const visitor = fakePeer("peer-visitor")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, visitor, guest)

  expect(rosterOf(visitor.sent[0])).toEqual([
    "Ada",
    guestNameForConnection("peer-visitor"),
  ])
})

test("a guest's JOIN adopts the name it kept locally", async () => {
  const registry = emptyRegistry()
  const visitor = fakePeer("peer-visitor")
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, visitor, guest)
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await receiveFromPeer(
    registry,
    ROOM,
    visitor,
    JSON.stringify({ type: "JOIN", payload: { name: "Wren" } }),
  )

  expect(rosterOf(visitor.published.at(-1)?.data)).toEqual(["Wren", "Ada"])
  expect(rosterOf(visitor.sent.at(-1))).toEqual(["Wren", "Ada"])
})

test("a member cannot rename itself over the wire — the session name stands", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  ada.published.length = 0

  await receiveFromPeer(
    registry,
    ROOM,
    ada,
    JSON.stringify({ type: "JOIN", payload: { name: "Administrator" } }),
  )

  expect(ada.published).toHaveLength(0)
  expect(rosterOf(ada.sent[0])).toEqual(["Ada"])
})

test("everyone in a room wears a different color", async () => {
  const registry = emptyRegistry()
  const peers = ["a", "b", "c"].map((id) => fakePeer(id))
  for (const peer of peers) await joinRoom(registry, ROOM, peer, guest)

  const roster = registry.rooms.get(ROOM)
  const colors = [...(roster?.seats.values() ?? [])].map(
    (seat) => seat.participant.color.background,
  )
  expect(new Set(colors).size).toBe(3)
})

test("a cursor is relayed to the rest of the room, stamped with its sender", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await receiveFromPeer(
    registry,
    ROOM,
    ada,
    JSON.stringify({
      type: "MOUSE_LOCATION",
      payload: {
        pointer: { x: 4, y: 8, tool: "pointer" },
        button: "up",
        selectedElementIds: {},
      },
    }),
  )

  expect(ada.published.at(-1)).toEqual({
    topic: ROOM_TOPIC,
    data: {
      type: "MOUSE_LOCATION",
      payload: {
        connectionId: "peer-ada",
        pointer: { x: 4, y: 8, tool: "pointer" },
        button: "up",
        selectedElementIds: {},
      },
    },
  })
})

test("garbage from a peer is dropped, not relayed", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, guest)
  ada.published.length = 0

  await receiveFromPeer(registry, ROOM, ada, "}{")
  await receiveFromPeer(registry, ROOM, ada, '{"type":"SCENE_UPDATE"}')
  await receiveFromPeer(
    registry,
    ROOM,
    ada,
    sceneUpdate([{ id: "x" } as never]),
  )

  expect(ada.published).toHaveLength(0)
})

test("a message from a peer that never joined is ignored", async () => {
  const registry = emptyRegistry()
  const stranger = fakePeer("peer-stranger")

  await receiveFromPeer(
    registry,
    ROOM,
    stranger,
    JSON.stringify({ type: "JOIN", payload: { name: "Wren" } }),
  )

  expect(stranger.published).toHaveLength(0)
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("leaving drops the participant and tells the rest", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, member("Grace"))

  await leaveRoom(registry, ROOM, grace)

  expect(rosterOf(grace.published.at(-1)?.data)).toEqual(["Ada"])
  expect(registry.rooms.get(ROOM)?.seats.size).toBe(1)
})

test("the last peer out takes the room with it", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await leaveRoom(registry, ROOM, ada)

  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("leaving twice is harmless", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await leaveRoom(registry, ROOM, ada)
  await expect(leaveRoom(registry, ROOM, ada)).resolves.toBeUndefined()
})

// --- follow mode (spec §1.3) --------------------------------------------

const follow = (target: string | null) =>
  JSON.stringify({
    type: "USER_FOLLOW",
    payload: { followedConnectionId: target },
  })

const viewport = (bounds: number[]) =>
  JSON.stringify({ type: "USER_VISIBLE_SCENE_BOUNDS", payload: { bounds } })

const followersIn = (message: ServerMessage | undefined) =>
  message?.type === "FOLLOWED_BY" ? message.payload.connectionIds : undefined

const viewportsIn = (peer: ReturnType<typeof fakePeer>) =>
  framesOf(peer, "USER_VISIBLE_SCENE_BOUNDS")

/** A room of `ada` and `grace`, with their join traffic already forgotten. */
async function twoPeerRoom() {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, member("Grace"))
  for (const peer of [ada, grace]) {
    peer.sent.length = 0
    peer.published.length = 0
  }
  return { registry, ada, grace }
}

test("the followed peer is told it has an audience", async () => {
  const { registry, ada, grace } = await twoPeerRoom()

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))

  expect(followersIn(ada.sent.at(-1))).toEqual(["peer-grace"])
  // Following is a private arrangement between two peers — nothing is
  // fanned out to the room.
  expect(grace.published).toHaveLength(0)
  expect(grace.sent).toHaveLength(0)
})

test("a viewport reaches the followers and nobody else", async () => {
  const { registry, ada, grace } = await twoPeerRoom()
  const wren = fakePeer("peer-wren")
  await joinRoom(registry, ROOM, wren, member("Wren"))
  wren.sent.length = 0

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  ada.sent.length = 0
  await receiveFromPeer(registry, ROOM, ada, viewport([0, 0, 100, 50]))

  expect(grace.sent.at(-1)).toEqual({
    type: "USER_VISIBLE_SCENE_BOUNDS",
    payload: { connectionId: "peer-ada", bounds: [0, 0, 100, 50] },
  })
  expect(viewportsIn(wren)).toHaveLength(0)
  expect(ada.published).toHaveLength(0)
})

test("two peers following each other don't drag each other around", async () => {
  const { registry, ada, grace } = await twoPeerRoom()
  const wren = fakePeer("peer-wren")
  await joinRoom(registry, ROOM, wren, member("Wren"))

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  await receiveFromPeer(registry, ROOM, ada, follow("peer-grace"))
  await receiveFromPeer(registry, ROOM, wren, follow("peer-ada"))
  for (const peer of [ada, grace, wren]) peer.sent.length = 0

  await receiveFromPeer(registry, ROOM, ada, viewport([0, 0, 100, 50]))

  // Only the mutual edge is dropped — Wren, who follows Ada one way, still
  // gets the viewport.
  expect(viewportsIn(grace)).toHaveLength(0)
  expect(wren.sent.at(-1)).toMatchObject({
    type: "USER_VISIBLE_SCENE_BOUNDS",
    payload: { connectionId: "peer-ada" },
  })
})

test("a ring of three doesn't chase itself around the room", async () => {
  const { registry, ada, grace } = await twoPeerRoom()
  const wren = fakePeer("peer-wren")
  await joinRoom(registry, ROOM, wren, member("Wren"))

  // ada → grace → wren → ada. Relaying any edge of this would hand each peer
  // bounds that move its canvas, which publishes bounds of its own, forever.
  await receiveFromPeer(registry, ROOM, ada, follow("peer-grace"))
  await receiveFromPeer(registry, ROOM, grace, follow("peer-wren"))
  await receiveFromPeer(registry, ROOM, wren, follow("peer-ada"))
  for (const peer of [ada, grace, wren]) peer.sent.length = 0

  for (const peer of [ada, grace, wren])
    await receiveFromPeer(registry, ROOM, peer, viewport([0, 0, 100, 50]))

  for (const peer of [ada, grace, wren])
    expect(viewportsIn(peer)).toHaveLength(0)
})

test("a chain of follows is not a ring, and keeps relaying", async () => {
  const { registry, ada, grace } = await twoPeerRoom()
  const wren = fakePeer("peer-wren")
  await joinRoom(registry, ROOM, wren, member("Wren"))

  // wren → ada → grace: nobody closes the loop, so both hops carry.
  await receiveFromPeer(registry, ROOM, ada, follow("peer-grace"))
  await receiveFromPeer(registry, ROOM, wren, follow("peer-ada"))
  for (const peer of [ada, grace, wren]) peer.sent.length = 0

  await receiveFromPeer(registry, ROOM, grace, viewport([0, 0, 100, 50]))
  await receiveFromPeer(registry, ROOM, ada, viewport([5, 5, 105, 55]))

  expect(ada.sent.at(-1)).toMatchObject({
    payload: { connectionId: "peer-grace" },
  })
  expect(wren.sent.at(-1)).toMatchObject({
    payload: { connectionId: "peer-ada" },
  })
})

test("a viewport nobody is following is relayed to nobody", async () => {
  const { registry, ada, grace } = await twoPeerRoom()

  await receiveFromPeer(registry, ROOM, ada, viewport([0, 0, 1, 1]))

  expect(viewportsIn(grace)).toHaveLength(0)
})

test("stopping tells the peer its audience is gone", async () => {
  const { registry, ada, grace } = await twoPeerRoom()

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  await receiveFromPeer(registry, ROOM, grace, follow(null))

  expect(followersIn(ada.sent.at(-1))).toEqual([])

  ada.sent.length = 0
  await receiveFromPeer(registry, ROOM, ada, viewport([0, 0, 1, 1]))
  expect(viewportsIn(grace)).toHaveLength(0)
})

test("switching target updates both the old and the new audience", async () => {
  const { registry, ada, grace } = await twoPeerRoom()
  const wren = fakePeer("peer-wren")
  await joinRoom(registry, ROOM, wren, member("Wren"))
  wren.sent.length = 0

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  await receiveFromPeer(registry, ROOM, grace, follow("peer-wren"))

  expect(followersIn(ada.sent.at(-1))).toEqual([])
  expect(followersIn(wren.sent.at(-1))).toEqual(["peer-grace"])
})

test("following yourself, a stranger, or the same peer twice is a no-op", async () => {
  const { registry, ada, grace } = await twoPeerRoom()

  await receiveFromPeer(registry, ROOM, grace, follow("peer-grace"))
  await receiveFromPeer(registry, ROOM, grace, follow("peer-nobody"))
  expect(grace.sent).toHaveLength(0)
  expect(ada.sent).toHaveLength(0)

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  ada.sent.length = 0
  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  expect(ada.sent).toHaveLength(0)
})

test("a follower leaving takes its audience seat with it", async () => {
  const { registry, ada, grace } = await twoPeerRoom()

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  await leaveRoom(registry, ROOM, grace)

  expect(followersIn(ada.sent.at(-1))).toEqual([])
  // The departed follower must not still be relayed to.
  await receiveFromPeer(registry, ROOM, ada, viewport([0, 0, 1, 1]))
  expect(viewportsIn(grace)).toHaveLength(0)
})

test("when the followed peer leaves, the follow is forgotten", async () => {
  const { registry, ada, grace } = await twoPeerRoom()

  await receiveFromPeer(registry, ROOM, grace, follow("peer-ada"))
  await leaveRoom(registry, ROOM, ada)

  expect(registry.rooms.get(ROOM)?.follows.size).toBe(0)
})

test("rooms are isolated — a peer only ever sees its own drawing's roster", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, "drawing-1", ada, member("Ada"))
  await joinRoom(registry, "drawing-2", grace, member("Grace"))

  expect(rosterOf(grace.sent[0])).toEqual(["Grace"])
  expect(registry.rooms.get("drawing-1")?.seats.size).toBe(1)
  expect(registry.rooms.get("drawing-2")?.seats.size).toBe(1)
})

// --- the authoritative scene -------------------------------------------

test("a joiner is handed the stored scene", async () => {
  const stored = [element("rect", 3)]
  const registry = registryFrom(async () => ({
    elements: stored,
    access: { space: "private", createdBy: "owner-1" },
    readable: true,
  }))
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  expect(elementsOf(framesOf(ada, "SCENE_INIT")[0])).toEqual(stored)
  // Cached for the live badge and the reserved seat.
  expect(registry.rooms.get(ROOM)?.access).toEqual({
    space: "private",
    createdBy: "owner-1",
  })
})

test("the drawing is read once however many peers pile in at the same moment", async () => {
  let reads = 0
  const registry = registryFrom(async () => {
    reads += 1
    return { elements: [element("rect", 1)], access: null, readable: true }
  })
  const peers = ["a", "b", "c"].map((id) => fakePeer(id))

  await Promise.all(peers.map((peer) => joinRoom(registry, ROOM, peer, guest)))

  expect(reads).toBe(1)
  for (const peer of peers) {
    expect(elementsOf(framesOf(peer, "SCENE_INIT")[0])).toHaveLength(1)
  }
})

test("a late joiner gets the scene as edited, not as stored", async () => {
  const registry = registryFrom(async () => ({
    elements: [element("rect", 1)],
    access: null,
    readable: true,
  }))
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("rect", 4)]))

  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, grace, member("Grace"))

  expect(elementsOf(framesOf(grace, "SCENE_INIT")[0])).toEqual([
    element("rect", 4),
  ])
})

test("a reader gets the Room's scene as edited, and nothing where no Room is open", async () => {
  const registry = registryFrom(async () => ({
    elements: [element("rect", 1)],
    access: null,
    readable: true,
  }))
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("rect", 4)]))

  expect(await roomElements(registry, ROOM)).toEqual([element("rect", 4)])
  expect(await roomElements(registry, "drawing-2")).toBeNull()
})

test("a reader waiting on a Room that fails to load is not handed an empty scene", async () => {
  const registry = registryFrom(async () => ({
    elements: [],
    access: null,
    readable: false,
  }))
  const joining = joinRoom(registry, ROOM, fakePeer("peer-ada"), member("Ada"))

  expect(await roomElements(registry, ROOM)).toBeNull()
  await joining
})

test("an edit is relayed to the rest of the room and merged into the Room's copy", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  ada.published.length = 0

  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("rect", 1)]))

  expect(ada.published).toEqual([
    {
      topic: ROOM_TOPIC,
      data: {
        type: "SCENE_UPDATE",
        payload: { elements: [element("rect", 1)] },
      },
    },
  ])
  expect(registry.rooms.get(ROOM)?.elements).toEqual([element("rect", 1)])
})

test("a stale edit is refused, and its sender is handed the version that won", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, member("Grace"))
  await receiveFromPeer(
    registry,
    ROOM,
    ada,
    sceneUpdate([element("rect", 9, { text: "winner" })]),
  )
  grace.published.length = 0

  await receiveFromPeer(
    registry,
    ROOM,
    grace,
    sceneUpdate([element("rect", 2, { text: "loser" })]),
  )

  // The room hears the winner, not the stale claim...
  expect(elementsOf(grace.published.at(-1)?.data)).toEqual([
    element("rect", 9, { text: "winner" }),
  ])
  // ...and so does the peer that sent it, which is how it converges.
  expect(elementsOf(framesOf(grace, "SCENE_UPDATE").at(-1))).toEqual([
    element("rect", 9, { text: "winner" }),
  ])
  expect(registry.rooms.get(ROOM)?.elements).toEqual([
    element("rect", 9, { text: "winner" }),
  ])
})

test("an accepted edit needs no correction back to its sender", async () => {
  const registry = emptyRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("rect", 1)]))

  expect(framesOf(ada, "SCENE_UPDATE")).toHaveLength(0)
})

test("an edit that arrives before the scene has loaded still merges into it", async () => {
  let release = () => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  const registry = registryFrom(async () => {
    await opened
    return {
      elements: [element("stored", 1, { index: "a0" })],
      access: null,
      readable: true,
    }
  })
  const ada = fakePeer("peer-ada")

  const joined = joinRoom(registry, ROOM, ada, member("Ada"))
  const edited = receiveFromPeer(
    registry,
    ROOM,
    ada,
    sceneUpdate([element("drawn", 1, { index: "a1" })]),
  )
  release()
  await Promise.all([joined, edited])

  expect(registry.rooms.get(ROOM)?.elements.map((e) => e.id)).toEqual([
    "stored",
    "drawn",
  ])
})

test("a Room whose drawing cannot be read hangs up, so clients retry a fresh read", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const registry = registryFrom(async () => {
      throw new Error("database is down")
    })
    const ada = fakePeer("peer-ada")

    await joinRoom(registry, ROOM, ada, member("Ada"))

    expect(framesOf(ada, "SCENE_INIT")).toEqual([])
    expect(ada.closes).toEqual([{ code: 1011, reason: "Scene unavailable" }])
    expect(registry.rooms.has(ROOM)).toBe(false)
  } finally {
    errors.mockRestore()
  }
})

test("a peer that left mid-load is not sent a scene", async () => {
  let release = () => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  const registry = registryFrom(async () => {
    await opened
    return { elements: [], access: null, readable: true }
  })
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")

  const joined = Promise.all([
    joinRoom(registry, ROOM, ada, member("Ada")),
    joinRoom(registry, ROOM, grace, member("Grace")),
  ])
  await leaveRoom(registry, ROOM, ada)
  release()
  await joined

  expect(framesOf(ada, "SCENE_INIT")).toHaveLength(0)
  expect(framesOf(grace, "SCENE_INIT")).toHaveLength(1)
})

/** Seats guests up to their cap, so the next guest is the one refused. */
async function fillRoom(registry: RoomRegistry) {
  const peers = Array.from({ length: MAX_ROOM_PARTICIPANTS - 1 }, (_, i) =>
    fakePeer(`peer-${i}`),
  )
  await Promise.all(peers.map((peer) => joinRoom(registry, ROOM, peer, guest)))
  return peers
}

/** A registry over an empty drawing owned by `member("Owen")`. */
const ownedRegistry = () =>
  emptyRegistry(async () => ({
    elements: [],
    access: { space: "private", createdBy: member("Owen").userId },
    readable: true,
  }))

test("guests fill every seat but the owner's", async () => {
  const registry = emptyRegistry()
  await fillRoom(registry)

  expect(registry.rooms.get(ROOM)?.seats.size).toBe(MAX_ROOM_PARTICIPANTS - 1)
})

test("the owner gets into a room guests have filled", async () => {
  const registry = ownedRegistry()
  await fillRoom(registry)
  await joinRoom(registry, ROOM, fakePeer("peer-late"), guest)

  expect(
    await joinRoom(registry, ROOM, fakePeer("peer-owner"), member("Owen")),
  ).toEqual({ status: "ok" })
})

test("the owner's tabs still stop at the cap", async () => {
  const registry = ownedRegistry()
  await fillRoom(registry)
  await joinRoom(registry, ROOM, fakePeer("peer-owner-1"), member("Owen"))

  expect(
    await joinRoom(registry, ROOM, fakePeer("peer-owner-2"), member("Owen")),
  ).toEqual({ status: "full" })
  expect(registry.rooms.get(ROOM)?.seats.size).toBe(MAX_ROOM_PARTICIPANTS)
})

test("a member who is not the owner stops with the guests", async () => {
  const registry = ownedRegistry()
  await fillRoom(registry)

  expect(
    await joinRoom(registry, ROOM, fakePeer("peer-ada"), member("Ada")),
  ).toEqual({ status: "full" })
})

test("in a Team room, any member gets the seat guests can't take", async () => {
  const registry = emptyRegistry(async () => ({
    elements: [],
    access: { space: "team", createdBy: member("Owen").userId },
    readable: true,
  }))
  await fillRoom(registry)

  expect(
    await joinRoom(registry, ROOM, fakePeer("peer-ada"), member("Ada")),
  ).toEqual({ status: "ok" })
})

test("the socket past the cap is refused and joins nothing", async () => {
  const registry = emptyRegistry()
  await fillRoom(registry)
  const late = fakePeer("peer-late")

  expect(await joinRoom(registry, ROOM, late, guest)).toEqual({
    status: "full",
  })
  expect(late.sent).toEqual([])
  expect(late.topics).toEqual([])
  expect(registry.rooms.get(ROOM)?.seats.size).toBe(MAX_ROOM_PARTICIPANTS - 1)
})

test("the room the refused socket knocked on is not told about it", async () => {
  const registry = emptyRegistry()
  await fillRoom(registry)
  const late = fakePeer("peer-late")

  await joinRoom(registry, ROOM, late, guest)

  expect(late.published).toEqual([])
})

test("a refused join does not start a scene read", async () => {
  let reads = 0
  const registry = registryFrom(async () => {
    reads += 1
    return { elements: [], access: null, readable: true }
  })
  await fillRoom(registry)

  await joinRoom(registry, ROOM, fakePeer("peer-late"), guest)

  // One read for the Room itself, and none on the way back out.
  expect(reads).toBe(1)
})

test("a departure frees the slot", async () => {
  const registry = emptyRegistry()
  await fillRoom(registry)
  await leaveRoom(registry, ROOM, fakePeer("peer-0"))

  expect(await joinRoom(registry, ROOM, fakePeer("peer-late"), guest)).toEqual({
    status: "ok",
  })
})

test("a full room does not keep anyone out of a different drawing", async () => {
  const registry = emptyRegistry()
  await fillRoom(registry)

  expect(
    await joinRoom(registry, "drawing-2", fakePeer("peer-late"), guest),
  ).toEqual({ status: "ok" })
})

test("a PING is answered, and never fans out to the room", async () => {
  const registry = emptyRegistry()
  const peer = fakePeer("peer-a")
  await joinRoom(registry, ROOM, peer, guest)
  peer.sent.length = 0
  peer.published.length = 0

  await receiveFromPeer(registry, ROOM, peer, '{"type":"PING","payload":{}}')

  expect(peer.sent).toEqual([{ type: "PONG", payload: {} }])
  expect(peer.published).toEqual([])
})

test("a PING is answered while the room is still reading its scene", async () => {
  // The heartbeat starts the moment the socket opens, and a slow scene read
  // must not make the very first beat look like a dead connection.
  const registry = registryFrom(() => new Promise(() => {}) as Promise<never>)
  const peer = fakePeer("peer-a")
  void joinRoom(registry, ROOM, peer, guest)

  await receiveFromPeer(registry, ROOM, peer, '{"type":"PING","payload":{}}')

  expect(peer.sent.at(-1)).toEqual({ type: "PONG", payload: {} })
})

/** A registry over an empty drawing whose clock the test drives by hand. */
function clockedRegistry() {
  let clock = 1_000_000
  const registry = createRoomRegistry(
    async () => ({ elements: [], access: null, readable: true }),
    async () => {},
    () => clock,
  )
  return {
    registry,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

test("a seat nobody is sitting in does not turn a reconnect away", async () => {
  // The socket that died without a FIN: the server still holds its seat, and
  // there are only 25. Without the sweep the returning tab is told the
  // drawing is full and its unmerged scene is thrown away.
  const { registry, advance } = clockedRegistry()
  await fillRoom(registry)

  advance(PARTICIPANT_IDLE_TIMEOUT_MS + 1)

  expect(await joinRoom(registry, ROOM, fakePeer("peer-back"), guest)).toEqual({
    status: "ok",
  })
})

test("a peer that keeps talking keeps its seat", async () => {
  const { registry, advance } = clockedRegistry()
  const seated = await fillRoom(registry)

  // Every one of them heartbeats on the way to the timeout.
  advance(PARTICIPANT_IDLE_TIMEOUT_MS - 1)
  for (const peer of seated)
    await receiveFromPeer(registry, ROOM, peer, '{"type":"PING","payload":{}}')
  advance(PARTICIPANT_IDLE_TIMEOUT_MS - 1)

  expect(await joinRoom(registry, ROOM, fakePeer("peer-late"), guest)).toEqual({
    status: "full",
  })
})

test("a forgotten peer is gone from the roster the next joiner is handed", async () => {
  const { registry, advance } = clockedRegistry()
  await joinRoom(registry, ROOM, fakePeer("peer-ghost"), member("Wren"))

  advance(PARTICIPANT_IDLE_TIMEOUT_MS + 1)
  const arriving = fakePeer("peer-new")
  await joinRoom(registry, ROOM, arriving, member("Ada"))

  expect(rosterOf(arriving.sent.find((m) => m.type === "ROOM_JOINED"))).toEqual(
    ["Ada"],
  )
})

test("a forgotten peer is told to rejoin rather than answered", async () => {
  // Its socket outlived the sweep. A PONG here would tell the client the
  // connection is healthy while the Room drops everything else it sends.
  const { registry, advance } = clockedRegistry()
  const ghost = fakePeer("peer-ghost")
  await joinRoom(registry, ROOM, ghost, guest)

  advance(PARTICIPANT_IDLE_TIMEOUT_MS + 1)
  await joinRoom(registry, ROOM, fakePeer("peer-new"), guest)
  ghost.sent.length = 0

  const outcome = await receiveFromPeer(
    registry,
    ROOM,
    ghost,
    '{"type":"PING","payload":{}}',
  )

  expect(outcome).toBe("evicted")
  expect(ghost.sent).toEqual([])
})

test("the sweep drops a silent peer without anyone joining", async () => {
  // A closed laptop lid: no close frame ever comes, and nobody else joins.
  const { registry, advance } = clockedRegistry()
  const ada = fakePeer("peer-ada")
  const ghost = fakePeer("peer-ghost")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, ghost, member("Wren"))

  advance(PARTICIPANT_IDLE_TIMEOUT_MS - 1)
  await receiveFromPeer(registry, ROOM, ada, '{"type":"PING","payload":{}}')
  advance(2)
  await sweepSilentParticipants(registry)

  expect(rosterOf(ada.sent.at(-1))).toEqual(["Ada"])
  expect(ghost.closes).toEqual([{ code: 1000, reason: "Rejoin" }])
  expect(ada.closes).toEqual([])
  expect([...(registry.rooms.get(ROOM)?.seats.keys() ?? [])]).toEqual([
    "peer-ada",
  ])
})

test("the sweep leaves a room alone while everyone is still talking", async () => {
  const { registry, advance } = clockedRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  const frames = ada.sent.length

  advance(PARTICIPANT_IDLE_TIMEOUT_MS - 1)
  await sweepSilentParticipants(registry)

  expect(ada.sent).toHaveLength(frames)
  expect(ada.closes).toEqual([])
})

test("a sweep that empties the room writes the scene and takes the room with it", async () => {
  let clock = 1_000_000
  const writes: string[][] = []
  const registry = createRoomRegistry(
    async () => ({ elements: [], access: null, readable: true }),
    async (_, elements) => {
      writes.push(elements.map((el) => el.id))
    },
    () => clock,
  )
  const ghost = fakePeer("peer-ghost")
  await joinRoom(registry, ROOM, ghost, guest)
  await receiveFromPeer(registry, ROOM, ghost, sceneUpdate([element("g", 1)]))

  clock += PARTICIPANT_IDLE_TIMEOUT_MS + 1
  await sweepSilentParticipants(registry)

  expect(writes).toEqual([["g"]])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("a seated peer's heartbeat is answered and holds its seat", async () => {
  const { registry } = clockedRegistry()
  const peer = fakePeer("peer-a")
  await joinRoom(registry, ROOM, peer, guest)
  peer.sent.length = 0

  const outcome = await receiveFromPeer(
    registry,
    ROOM,
    peer,
    '{"type":"PING","payload":{}}',
  )

  expect(outcome).toBe("ok")
  expect(peer.sent).toEqual([{ type: "PONG", payload: {} }])
})

test("a frame for a drawing with no room at all is not an eviction", async () => {
  const registry = emptyRegistry()
  const stranger = fakePeer("peer-stranger")

  expect(
    await receiveFromPeer(
      registry,
      ROOM,
      stranger,
      '{"type":"PING","payload":{}}',
    ),
  ).toBe("ok")
})

// --- persistence (spec §2.3) --------------------------------------------

/** A registry that records what each flush wrote, in order. */
function recordingRegistry(
  stored: SceneElement[] = [],
  save?: SceneSaver,
  options: { readable?: boolean; access?: AccessRow } = {},
): RoomRegistry & { writes: SceneElement[][] } {
  const writes: SceneElement[][] = []
  const registry = registryFrom(
    async () => ({
      elements: stored,
      access: options.access ?? { space: "private", createdBy: "owner-1" },
      readable: options.readable ?? true,
    }),
    async (roomId, elements) => {
      writes.push(elements)
      await save?.(roomId, elements)
    },
  )
  return Object.assign(registry, { writes })
}

const idsOf = (elements: SceneElement[]) => elements.map((el) => el.id)

test("an edit is written once the dirty throttle elapses, not on the edit itself", async () => {
  vi.useFakeTimers()
  try {
    const registry = recordingRegistry()
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))

    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))
    expect(registry.writes).toEqual([])

    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS)
    expect(registry.writes.map(idsOf)).toEqual([["a"]])
  } finally {
    vi.useRealTimers()
  }
})

test("a burst of edits inside one window costs one write, carrying the latest scene", async () => {
  vi.useFakeTimers()
  try {
    const registry = recordingRegistry()
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))

    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS / 3)
    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("b", 1)]))
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS)

    expect(registry.writes.map(idsOf)).toEqual([["a", "b"]])
  } finally {
    vi.useRealTimers()
  }
})

test("a delta the room discards is not worth a write", async () => {
  vi.useFakeTimers()
  try {
    const registry = recordingRegistry([element("rect", 9)])
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))

    // Older than what the Room holds, so reconciliation keeps its own copy.
    await receiveFromPeer(
      registry,
      ROOM,
      ada,
      sceneUpdate([element("rect", 2)]),
    )
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS * 2)

    expect(registry.writes).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

test("the last participant out writes the scene before the room is torn down", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await receiveFromPeer(registry, ROOM, grace, sceneUpdate([element("g", 1)]))
  // The owner closing their tab is not what persists the guest's work…
  await leaveRoom(registry, ROOM, ada)
  expect(registry.writes).toEqual([])

  // …the room emptying is.
  await leaveRoom(registry, ROOM, grace)
  expect(registry.writes.map(idsOf)).toEqual([["g"]])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("an empty room with nothing unwritten goes quietly", async () => {
  const registry = recordingRegistry([element("rect", 1)])
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await leaveRoom(registry, ROOM, ada)

  expect(registry.writes).toEqual([])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("a room that could not read its drawing never writes over it", async () => {
  vi.useFakeTimers()
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const writes: SceneElement[][] = []
    const registry = registryFrom(
      async () => {
        throw new Error("database is down")
      },
      async (_roomId, elements) => {
        writes.push(elements)
      },
    )
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))

    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS * 2)
    await leaveRoom(registry, ROOM, ada)

    expect(writes).toEqual([])
  } finally {
    errors.mockRestore()
    vi.useRealTimers()
  }
})

test("a failed write is retried, and the empty room stays until it lands", async () => {
  vi.useFakeTimers()
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    let fail = true
    const registry = recordingRegistry([], async () => {
      // Shaped like a failed query, whose message lists the scene.
      if (fail)
        throw new Error("Failed query: update … params: <scene>", {
          cause: Object.assign(new Error("connection refused"), {
            code: "ECONNREFUSED",
          }),
        })
    })
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))
    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))

    await leaveRoom(registry, ROOM, ada)
    // The write failed, so the edits are still only in memory — dropping the
    // Room now would drop them.
    expect(registry.writes.map(idsOf)).toEqual([["a"]])
    expect(registry.rooms.has(ROOM)).toBe(true)
    // Only the code is logged: the scene never lands in the logs.
    expect(errors).toHaveBeenCalledWith(
      `[collab] could not flush room ${ROOM}`,
      "ECONNREFUSED",
    )

    fail = false
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS)
    expect(registry.writes.map(idsOf)).toEqual([["a"], ["a"]])
    expect(registry.rooms.has(ROOM)).toBe(false)
  } finally {
    errors.mockRestore()
    vi.useRealTimers()
  }
})

test("shutdown writes every room holding unsaved work, then asks peers to reconnect", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, "drawing-1", ada, member("Ada"))
  await joinRoom(registry, "drawing-2", grace, guest)
  await receiveFromPeer(
    registry,
    "drawing-1",
    ada,
    sceneUpdate([element("a", 1)]),
  )
  await receiveFromPeer(
    registry,
    "drawing-2",
    grace,
    sceneUpdate([element("b", 1)]),
  )

  await closeAllRooms(registry)

  expect(registry.writes.map(idsOf).sort()).toEqual([["a"], ["b"]])
  // Not the dead-link code: the client must retry and reach the new process.
  for (const peer of [ada, grace])
    expect(peer.closes.map((c) => c.code)).toEqual([SERVER_RESTART_CLOSE_CODE])
})

test("an edit sent during the shutdown write is refused, so its sender keeps it", async () => {
  let finishSave: (() => void) | undefined
  const saveFinished = new Promise<void>((resolve) => {
    finishSave = resolve
  })
  const registry = recordingRegistry([], () => saveFinished)
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)
  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))

  const closing = closeAllRooms(registry)
  const outcome = await receiveFromPeer(
    registry,
    ROOM,
    ada,
    sceneUpdate([element("late", 1)]),
  )
  finishSave?.()
  await closing

  // Not merged, so nobody heard it and nothing in memory is left unwritten.
  expect(outcome).toBe("evicted")
  expect(
    ada.published.flatMap(({ data }) =>
      data.type === "SCENE_UPDATE" ? idsOf(data.payload.elements) : [],
    ),
  ).toEqual(["a"])
  expect(registry.writes.map(idsOf)).toEqual([["a"]])
  expect(registry.rooms.size).toBe(0)
})

test("a join during shutdown is refused and starts no room", async () => {
  const registry = recordingRegistry()
  const closing = closeAllRooms(registry)

  const ada = fakePeer("peer-ada")
  expect(await joinRoom(registry, ROOM, ada, member("Ada"))).toEqual({
    status: "closing",
  })
  await closing

  expect(ada.sent).toEqual([])
  expect(registry.rooms.size).toBe(0)
})

test("a rejoin during the final write keeps the room alive", async () => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const registry = recordingRegistry([], () => held)
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))

  const leaving = leaveRoom(registry, ROOM, ada)
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, grace, guest)
  release()
  await leaving

  expect(registry.rooms.get(ROOM)?.seats.size).toBe(1)
  // The rejoiner is handed the live scene, not a re-read of the drawing.
  expect(elementsOf(framesOf(grace, "SCENE_INIT")[0])).toEqual([
    element("a", 1),
  ])
})

// It could never be written, so edits made in it would be lost on leave.
test("a drawing whose stored scene is unreadable opens no Room to draw in", async () => {
  const registry = recordingRegistry([], undefined, { readable: false })
  const ada = fakePeer("peer-ada")

  const joined = joinRoom(registry, ROOM, ada, member("Ada"))
  const edited = receiveFromPeer(
    registry,
    ROOM,
    ada,
    sceneUpdate([element("a", 1)]),
  )
  await joined

  expect(await edited).toBe("evicted")
  expect(framesOf(ada, "SCENE_INIT")).toEqual([])
  expect(ada.closes).toEqual([
    {
      code: SCENE_UNREADABLE_CLOSE_CODE,
      reason: SCENE_UNREADABLE_CLOSE_REASON,
    },
  ])
  expect(registry.rooms.has(ROOM)).toBe(false)
  expect(registry.writes).toEqual([])
})

// Regression: dirtiness was decided by `getSceneVersion`, a sum of versions.
// An element that wins on the versionNonce tie-break has the same version, so
// the sum and the element count both stay put — the room relayed the new
// content to every peer and the database kept the old.
test("an edit that wins on the nonce tie-break is still persisted", async () => {
  vi.useFakeTimers()
  try {
    const stored = element("rect", 4, { versionNonce: 9 })
    const registry = recordingRegistry([stored])
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))

    // Same version, lower nonce — reconciliation's deterministic winner.
    const winner = element("rect", 4, { versionNonce: 2, extra: "new" })
    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([winner]))
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS)

    expect(registry.writes).toHaveLength(1)
    expect(registry.writes[0][0].versionNonce).toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

// --- link lifecycle (spec §4.2, §5.1) -----------------------------------

test("a terminated room writes the session's work before any socket closes", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)
  await receiveFromPeer(registry, ROOM, grace, sceneUpdate([element("g", 1)]))

  // What the guest drew has to be in the database by the time its socket
  // learns the link is gone — that is the whole promise of spec §5.1.
  let writesWhenClosed: number | null = null
  grace.close = () => {
    writesWhenClosed = registry.writes.length
  }

  await terminateRoom(registry, ROOM)

  expect(registry.writes.map(idsOf)).toEqual([["g"]])
  expect(writesWhenClosed).toBe(1)
})

test("terminating closes every socket with the dead-link code", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await terminateRoom(registry, ROOM)

  // Owner and guest alike: stop and regenerate evict everyone.
  expect(ada.closes).toEqual([
    { code: LINK_DEAD_CLOSE_CODE, reason: "Link no longer active" },
  ])
  expect(grace.closes).toEqual([
    { code: LINK_DEAD_CLOSE_CODE, reason: "Link no longer active" },
  ])
})

test("a terminated room is gone, so re-sharing reads the drawing fresh", async () => {
  let reads = 0
  const registry = registryFrom(async () => {
    reads += 1
    return {
      elements: [],
      access: { space: "private", createdBy: "owner-1" },
      readable: true,
    }
  })
  await joinRoom(registry, ROOM, fakePeer("peer-ada"), member("Ada"))

  await terminateRoom(registry, ROOM)
  expect(registry.rooms.has(ROOM)).toBe(false)

  await joinRoom(registry, ROOM, fakePeer("peer-nina"), member("Nina"))
  expect(reads).toBe(2)
})

test("terminating a drawing nobody is in is a no-op", async () => {
  const registry = recordingRegistry()

  await terminateRoom(registry, ROOM)

  expect(registry.writes).toEqual([])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("the close hooks a termination fires don't write a second time", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))

  await terminateRoom(registry, ROOM)
  // The browser answers the close by firing the route's `close` hook, which
  // is `leaveRoom` — for a room that no longer has it, or no longer exists.
  await leaveRoom(registry, ROOM, ada)

  expect(registry.writes.map(idsOf)).toEqual([["a"]])
})

test("a termination whose final write fails keeps the room until it lands", async () => {
  vi.useFakeTimers()
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    let fail = true
    const registry = recordingRegistry([], async () => {
      if (fail) throw new Error("database is down")
    })
    const ada = fakePeer("peer-ada")
    await joinRoom(registry, ROOM, ada, member("Ada"))
    await receiveFromPeer(registry, ROOM, ada, sceneUpdate([element("a", 1)]))

    await terminateRoom(registry, ROOM)
    // The link is dead either way — that is a database row, not a socket —
    // but the edits are still only in memory, so the Room stays to retry.
    expect(ada.closes).toHaveLength(1)
    expect(registry.rooms.has(ROOM)).toBe(true)

    fail = false
    await vi.advanceTimersByTimeAsync(ROOM_FLUSH_INTERVAL_MS)
    expect(registry.writes.map(idsOf)).toEqual([["a"], ["a"]])
    expect(registry.rooms.has(ROOM)).toBe(false)
  } finally {
    errors.mockRestore()
    vi.useRealTimers()
  }
})

const LINK_DEAD = {
  code: LINK_DEAD_CLOSE_CODE,
  reason: "Link no longer active",
}

// --- trash mid-session (Team space stories 47, 48) -----------------------

const teamRoom = () =>
  recordingRegistry([], undefined, {
    access: { space: "team", createdBy: "owner-1" },
  })

const ADA = { userId: "u:Ada", name: "Ada" }

test("a trashed Team room tells members who trashed it, and guests nothing", async () => {
  const registry = teamRoom()
  const nina = fakePeer("peer-nina")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, nina, member("Nina"))
  await joinRoom(registry, ROOM, grace, guest)

  await trashRoom(registry, ROOM, ADA)

  expect(nina.closes).toEqual([
    { code: DRAWING_TRASHED_CLOSE_CODE, reason: "Ada" },
  ])
  // The same close any dead link gets: no name, no hint it was trashed.
  expect(grace.closes).toEqual([LINK_DEAD])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("the trasher's own tab is told it was trashed, without a name", async () => {
  const registry = teamRoom()
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await trashRoom(registry, ROOM, ADA)

  expect(ada.closes).toEqual([{ code: DRAWING_TRASHED_CLOSE_CODE, reason: "" }])
})

test("a trashed room writes the session's work before any socket closes", async () => {
  const registry = teamRoom()
  const nina = fakePeer("peer-nina")
  await joinRoom(registry, ROOM, nina, member("Nina"))
  await receiveFromPeer(registry, ROOM, nina, sceneUpdate([element("n", 1)]))

  let writesWhenClosed: number | null = null
  nina.close = () => {
    writesWhenClosed = registry.writes.length
  }

  await trashRoom(registry, ROOM, ADA)

  expect(registry.writes.map(idsOf)).toEqual([["n"]])
  expect(writesWhenClosed).toBe(1)
})

test("a member who can't see a trashed Private drawing gets the dead-link close", async () => {
  // A members link let Nina in; only the creator can see the drawing.
  const registry = recordingRegistry([], undefined, {
    access: { space: "private", createdBy: "u:Ada" },
  })
  const nina = fakePeer("peer-nina")
  await joinRoom(registry, ROOM, nina, member("Nina"))

  await trashRoom(registry, ROOM, ADA)

  expect(nina.closes).toEqual([LINK_DEAD])
})

test("a long trasher name is cut to the close-reason limit on a whole character", async () => {
  const registry = teamRoom()
  const nina = fakePeer("peer-nina")
  await joinRoom(registry, ROOM, nina, member("Nina"))

  // 1 + 40 × 4 bytes; 123 bytes fit "a" and 30 emoji, with no half emoji.
  await trashRoom(registry, ROOM, {
    userId: "u:x",
    name: `a${"😀".repeat(40)}`,
  })

  expect(nina.closes).toEqual([
    { code: DRAWING_TRASHED_CLOSE_CODE, reason: `a${"😀".repeat(30)}` },
  ])
})

test("a stopped link ends a Private drawing's room for everyone in it", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await endLinkRoom(registry, ROOM)

  expect(ada.closes).toEqual([LINK_DEAD])
  expect(grace.closes).toEqual([LINK_DEAD])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

// Members reach a Team drawing by id, so its Room never hangs on a link.
test("a stopped link sends only the guests out of a Team drawing's room", async () => {
  const registry = emptyRegistry(async () => ({
    elements: [],
    access: { space: "team", createdBy: "owner-1" },
    readable: true,
  }))
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await endLinkRoom(registry, ROOM)

  expect(ada.closes).toEqual([])
  expect(grace.closes).toEqual([LINK_DEAD])
  expect(registry.rooms.get(ROOM)?.seats.size).toBe(1)
})

// Story 25: a guest on an anyone link stays through a move to Team, and the
// Room is Team from then on.
test("a Room moved to Team keeps every seat and then outlives its link", async () => {
  const registry = emptyRegistry(async () => ({
    elements: [],
    access: { space: "private", createdBy: "owner-1" },
    readable: true,
  }))
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await moveRoomToTeam(registry, ROOM)
  expect(ada.closes).toEqual([])
  expect(grace.closes).toEqual([])

  await endLinkRoom(registry, ROOM)
  expect(ada.closes).toEqual([])
  expect(grace.closes).toEqual([LINK_DEAD])
})

test("tightening to members closes the guests and leaves the members", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await evictNonMembers(registry, ROOM)

  expect(grace.closes).toEqual([
    { code: LINK_DEAD_CLOSE_CODE, reason: "Link no longer active" },
  ])
  expect(ada.closes).toEqual([])
  expect(registry.rooms.get(ROOM)?.seats.size).toBe(1)
})

test("the members left behind are told the guests are gone", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)

  await evictNonMembers(registry, ROOM)

  // Sent, not published: the only peers that could have fanned this out are
  // the ones being closed.
  expect(rosterOf(ada.sent.at(-1))).toEqual(["Ada"])
})

test("a room of members loses nobody to a tighten", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const nina = fakePeer("peer-nina")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, nina, member("Nina"))
  const rosterFrames = framesOf(ada, "PARTICIPANTS").length

  await evictNonMembers(registry, ROOM)

  expect(ada.closes).toEqual([])
  expect(nina.closes).toEqual([])
  // Nothing changed, so nobody is told anything.
  expect(framesOf(ada, "PARTICIPANTS")).toHaveLength(rosterFrames)
})

test("a tighten that empties the room writes the scene and takes the room with it", async () => {
  const registry = recordingRegistry()
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, grace, guest)
  await receiveFromPeer(registry, ROOM, grace, sceneUpdate([element("g", 1)]))

  await evictNonMembers(registry, ROOM)

  expect(registry.writes.map(idsOf)).toEqual([["g"]])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("an evicted guest takes its follow edges with it", async () => {
  const registry = recordingRegistry()
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, ROOM, grace, guest)
  await receiveFromPeer(
    registry,
    ROOM,
    grace,
    JSON.stringify({
      type: "USER_FOLLOW",
      payload: { followedConnectionId: "peer-ada" },
    }),
  )

  await evictNonMembers(registry, ROOM)

  // Ada is told her audience is empty, and her viewport reaches nobody.
  expect(framesOf(ada, "FOLLOWED_BY").at(-1)).toMatchObject({
    payload: { connectionIds: [] },
  })
  expect(registry.rooms.get(ROOM)?.follows.size).toBe(0)
})

test("a stroke still in flight rides out on the final write", async () => {
  let release: (() => void) | undefined
  const loaded = new Promise<void>((resolve) => {
    release = resolve
  })
  const writes: SceneElement[][] = []
  const registry = registryFrom(
    async () => {
      await loaded
      return {
        elements: [],
        access: { space: "private", createdBy: "owner-1" },
        readable: true,
      }
    },
    async (_roomId, elements) => {
      writes.push(elements)
    },
  )
  const grace = fakePeer("peer-grace")
  const joined = joinRoom(registry, ROOM, grace, guest)
  // Sent while the Room is still reading its drawing — it waits for the load
  // rather than merging into an empty scene.
  const drawing = receiveFromPeer(
    registry,
    ROOM,
    grace,
    sceneUpdate([element("g", 1)]),
  )

  const terminated = terminateRoom(registry, ROOM)
  release?.()
  await Promise.all([joined, drawing, terminated])

  // The queued stroke merged first, so the termination's write carries it
  // instead of leaving it to a throttle tick nobody is left to hear.
  expect(writes.map(idsOf)).toEqual([["g"]])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

// Regression: the roster was emptied *after* the final write, leaving a
// window the length of a database round trip in which a peer still had a
// seat. Its edit merged into a Room whose write was already in flight,
// marked the Room dirty again, and survived only as a 15 s retry — landing
// after the owner had resumed classic autosave and overwriting it.
test("an edit sent during the final write is refused, not left owing", async () => {
  let beginSave: (() => void) | undefined
  const saveStarted = new Promise<void>((resolve) => {
    beginSave = resolve
  })
  let finishSave: (() => void) | undefined
  const saveFinished = new Promise<void>((resolve) => {
    finishSave = resolve
  })
  const writes: SceneElement[][] = []
  const registry = registryFrom(
    async () => ({
      elements: [],
      access: { space: "private", createdBy: "owner-1" },
      readable: true,
    }),
    async (_roomId, elements) => {
      writes.push(elements)
      beginSave?.()
      await saveFinished
    },
  )
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, grace, guest)
  await receiveFromPeer(registry, ROOM, grace, sceneUpdate([element("g", 1)]))

  const terminated = terminateRoom(registry, ROOM)
  await saveStarted

  // Mid-write, and the socket does not know yet that its link is gone.
  const outcome = await receiveFromPeer(
    registry,
    ROOM,
    grace,
    sceneUpdate([element("h", 1)]),
  )
  expect(outcome).toBe("evicted")

  finishSave?.()
  await terminated

  // One write, and nothing left behind owing another: no Room in the
  // registry means no armed retry to land on the owner's next solo save.
  expect(writes.map(idsOf)).toEqual([["g"]])
  expect(registry.rooms.has(ROOM)).toBe(false)
})

test("evicting from a drawing nobody is in is a no-op", async () => {
  const registry = recordingRegistry()

  await evictNonMembers(registry, ROOM)

  expect(registry.writes).toEqual([])
})

test("a deleted member is closed out of every Room, and nobody else is", async () => {
  const registry = recordingRegistry()
  const daveTeam = fakePeer("peer-dave-team")
  const daveLink = fakePeer("peer-dave-link")
  const ada = fakePeer("peer-ada")
  const grace = fakePeer("peer-grace")
  await joinRoom(registry, ROOM, daveTeam, member("Dave"))
  await joinRoom(registry, ROOM, ada, member("Ada"))
  await joinRoom(registry, "drawing-2", daveLink, member("Dave"))
  await joinRoom(registry, "drawing-2", grace, guest)

  await evictUser(registry, "u:Dave")

  for (const peer of [daveTeam, daveLink])
    expect(peer.closes).toEqual([
      { code: LINK_DEAD_CLOSE_CODE, reason: "Link no longer active" },
    ])
  expect(ada.closes).toEqual([])
  expect(grace.closes).toEqual([])
  expect(rosterOf(ada.sent.at(-1))).toEqual(["Ada"])
})

test("an edit a deleted member sends after the eviction is refused", async () => {
  const registry = recordingRegistry()
  const dave = fakePeer("peer-dave")
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, dave, member("Dave"))
  await joinRoom(registry, ROOM, ada, member("Ada"))

  await evictUser(registry, "u:Dave")
  const outcome = await receiveFromPeer(
    registry,
    ROOM,
    dave,
    sceneUpdate([element("d", 1)]),
  )

  expect(outcome).toBe("evicted")
  expect(registry.rooms.get(ROOM)?.elements).toEqual([])
})

test("a forged version jump is dropped, so a member's next edit still wins", async () => {
  const registry = registryFrom(async () => ({
    elements: [element("e1", 1)],
    access: null,
    readable: true,
  }))
  const intruder = fakePeer("peer-guest")
  const ada = fakePeer("peer-ada")
  await joinRoom(registry, ROOM, intruder, guest)
  await joinRoom(registry, ROOM, ada, member("Ada"))
  const stored = () => registry.rooms.get(ROOM)?.elements ?? []

  const jump = 2 ** 20
  await receiveFromPeer(
    registry,
    ROOM,
    intruder,
    sceneUpdate([element("e1", 2 + jump), element("new", 2 + jump)]),
  )
  expect(stored()).toEqual([element("e1", 1)])

  // The largest jump lands, the member's +1 beats it as usual, and a
  // duplicate keeps its source's version under a new id.
  await receiveFromPeer(
    registry,
    ROOM,
    intruder,
    sceneUpdate([element("e1", 1 + jump, { versionNonce: 0 })]),
  )
  await receiveFromPeer(
    registry,
    ROOM,
    ada,
    sceneUpdate([
      element("e1", 2 + jump, { isDeleted: true }),
      element("copy", 1 + jump, { index: "a1" }),
    ]),
  )
  expect(stored()).toEqual([
    element("e1", 2 + jump, { isDeleted: true }),
    element("copy", 1 + jump, { index: "a1" }),
  ])
})
