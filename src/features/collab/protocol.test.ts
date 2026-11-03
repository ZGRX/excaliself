import { expect, test } from "vitest"
import {
  MAX_NAME_LENGTH,
  parseClientMessage,
  parseServerMessage,
  sanitizeName,
} from "./protocol"

test("a JOIN message carries the sanitized name", () => {
  expect(
    parseClientMessage('{"type":"JOIN","payload":{"name":"  Ada  "}}'),
  ).toEqual({ type: "JOIN", payload: { name: "Ada" } })
})

test("a JOIN without a usable name is dropped, leaving the server's pseudonym", () => {
  expect(
    parseClientMessage('{"type":"JOIN","payload":{"name":"   "}}'),
  ).toBeNull()
  expect(parseClientMessage('{"type":"JOIN","payload":{"name":42}}')).toBeNull()
  expect(parseClientMessage('{"type":"JOIN"}')).toBeNull()
})

test("names are stripped of control characters and clamped", () => {
  expect(sanitizeName("Ada\nLovelace")).toBe("Ada Lovelace")
  expect(sanitizeName("x".repeat(200))).toHaveLength(MAX_NAME_LENGTH)
  // Clamping counts code points, so an emoji name is never cut mid-surrogate.
  expect(sanitizeName("🐙".repeat(50))).toBe("🐙".repeat(MAX_NAME_LENGTH))
})

test("a MOUSE_LOCATION message round-trips the cursor", () => {
  const raw = JSON.stringify({
    type: "MOUSE_LOCATION",
    payload: {
      pointer: { x: 12.5, y: -3, tool: "pointer" },
      button: "down",
      selectedElementIds: { a: true, b: true },
    },
  })
  expect(parseClientMessage(raw)).toEqual({
    type: "MOUSE_LOCATION",
    payload: {
      pointer: { x: 12.5, y: -3, tool: "pointer" },
      button: "down",
      selectedElementIds: { a: true, b: true },
    },
  })
})

test("a MOUSE_LOCATION with a missing or non-finite pointer is dropped", () => {
  const bad = [
    { pointer: { x: 1, y: 2 }, button: "up", selectedElementIds: {} },
    { pointer: { x: "1", y: 2, tool: "pointer" }, button: "up" },
    { pointer: { x: Number.NaN, y: 2, tool: "pointer" }, button: "up" },
    { pointer: { x: 1, y: 2, tool: "eraser" }, button: "up" },
    { pointer: { x: 1, y: 2, tool: "pointer" }, button: "sideways" },
  ]
  for (const payload of bad) {
    const raw = JSON.stringify({ type: "MOUSE_LOCATION", payload })
    expect(parseClientMessage(raw), raw).toBeNull()
  }
})

test("selectedElementIds is rebuilt, so a peer can't smuggle arbitrary values through it", () => {
  const raw = JSON.stringify({
    type: "MOUSE_LOCATION",
    payload: {
      pointer: { x: 0, y: 0, tool: "laser" },
      button: "up",
      selectedElementIds: { a: { nested: "junk" } },
    },
  })
  expect(parseClientMessage(raw)?.payload).toMatchObject({
    selectedElementIds: { a: true },
  })
})

test("garbage and unknown types are ignored rather than thrown", () => {
  expect(parseClientMessage("not json")).toBeNull()
  expect(parseClientMessage("[]")).toBeNull()
  expect(parseClientMessage('{"type":"SCENE_UPDATE","payload":{}}')).toBeNull()
})

test("USER_FOLLOW names a target, and null says 'nobody'", () => {
  expect(
    parseClientMessage(
      '{"type":"USER_FOLLOW","payload":{"followedConnectionId":"peer-a"}}',
    ),
  ).toEqual({
    type: "USER_FOLLOW",
    payload: { followedConnectionId: "peer-a" },
  })
  expect(
    parseClientMessage(
      '{"type":"USER_FOLLOW","payload":{"followedConnectionId":null}}',
    ),
  ).toEqual({ type: "USER_FOLLOW", payload: { followedConnectionId: null } })
})

test("a USER_FOLLOW without a string-or-null target is dropped", () => {
  expect(parseClientMessage('{"type":"USER_FOLLOW","payload":{}}')).toBeNull()
  expect(
    parseClientMessage(
      '{"type":"USER_FOLLOW","payload":{"followedConnectionId":7}}',
    ),
  ).toBeNull()
})

test("USER_VISIBLE_SCENE_BOUNDS round-trips the four scene coordinates", () => {
  expect(
    parseClientMessage(
      '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":[-10,0,20.5,30]}}',
    ),
  ).toEqual({
    type: "USER_VISIBLE_SCENE_BOUNDS",
    payload: { bounds: [-10, 0, 20.5, 30] },
  })
})

test("bounds that aren't four finite numbers are dropped", () => {
  const bad = [
    '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":[1,2,3]}}',
    '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":[1,2,3,4,5]}}',
    '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":[1,2,3,"4"]}}',
    '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":[1,2,3,null]}}',
    '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":{}}}',
    '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{}}',
  ]
  for (const raw of bad) expect(parseClientMessage(raw), raw).toBeNull()
})

// --- the client's side of the wire -------------------------------------

const PARTICIPANT = {
  connectionId: "peer-a",
  name: "Wren",
  color: { background: "#fa5252", stroke: "#c92a2a" },
  isGuest: true,
}

test("ROOM_JOINED carries this tab's connection id and the roster", () => {
  const raw = JSON.stringify({
    type: "ROOM_JOINED",
    payload: { connectionId: "peer-self", participants: [PARTICIPANT] },
  })
  expect(parseServerMessage(raw)).toEqual({
    type: "ROOM_JOINED",
    payload: { connectionId: "peer-self", participants: [PARTICIPANT] },
  })
})

test("PARTICIPANTS carries the roster on its own", () => {
  const raw = JSON.stringify({
    type: "PARTICIPANTS",
    payload: { participants: [PARTICIPANT] },
  })
  expect(parseServerMessage(raw)).toEqual({
    type: "PARTICIPANTS",
    payload: { participants: [PARTICIPANT] },
  })
})

test("a relayed cursor keeps the sender it was stamped with", () => {
  const raw = JSON.stringify({
    type: "MOUSE_LOCATION",
    payload: {
      connectionId: "peer-a",
      pointer: { x: 1, y: 2, tool: "laser" },
      button: "up",
      selectedElementIds: {},
    },
  })
  expect(parseServerMessage(raw)).toMatchObject({
    payload: { connectionId: "peer-a" },
  })
})

test("FOLLOWED_BY carries the connection ids trailing this tab", () => {
  const raw = JSON.stringify({
    type: "FOLLOWED_BY",
    payload: { connectionIds: ["peer-a", "peer-b"] },
  })
  expect(parseServerMessage(raw)).toEqual({
    type: "FOLLOWED_BY",
    payload: { connectionIds: ["peer-a", "peer-b"] },
  })
})

test("a relayed viewport keeps the sender it was stamped with", () => {
  const raw = JSON.stringify({
    type: "USER_VISIBLE_SCENE_BOUNDS",
    payload: { connectionId: "peer-a", bounds: [0, 0, 100, 50] },
  })
  expect(parseServerMessage(raw)).toEqual({
    type: "USER_VISIBLE_SCENE_BOUNDS",
    payload: { connectionId: "peer-a", bounds: [0, 0, 100, 50] },
  })
})

test("a malformed follow frame is ignored rather than thrown", () => {
  expect(parseServerMessage('{"type":"FOLLOWED_BY","payload":{}}')).toBeNull()
  expect(
    parseServerMessage(
      '{"type":"FOLLOWED_BY","payload":{"connectionIds":[1]}}',
    ),
  ).toBeNull()
  expect(
    parseServerMessage(
      '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"bounds":[0,0,1,1]}}',
    ),
  ).toBeNull()
  expect(
    parseServerMessage(
      '{"type":"USER_VISIBLE_SCENE_BOUNDS","payload":{"connectionId":"peer-a","bounds":[0,0,1]}}',
    ),
  ).toBeNull()
})

test("a malformed frame is ignored rather than thrown out of a socket callback", () => {
  expect(parseServerMessage("nope")).toBeNull()
  expect(parseServerMessage('{"type":"PARTICIPANTS","payload":{}}')).toBeNull()
  expect(
    parseServerMessage(
      '{"type":"PARTICIPANTS","payload":{"participants":[{"connectionId":1}]}}',
    ),
  ).toBeNull()
  expect(
    parseServerMessage('{"type":"ROOM_JOINED","payload":{"participants":[]}}'),
  ).toBeNull()
  expect(
    parseServerMessage(
      '{"type":"MOUSE_LOCATION","payload":{"pointer":{"x":1,"y":2,"tool":"pointer"},"button":"up"}}',
    ),
  ).toBeNull()
})

test("a scene delta keeps every element property, not just the ones it validates", () => {
  const element = {
    id: "rect",
    version: 4,
    versionNonce: 77,
    index: "a1",
    type: "rectangle",
    x: 10,
    strokeColor: "#1e1e1e",
    boundElements: null,
  }
  const raw = JSON.stringify({
    type: "SCENE_UPDATE",
    payload: { elements: [element] },
  })

  expect(parseClientMessage(raw)).toEqual({
    type: "SCENE_UPDATE",
    payload: { elements: [element] },
  })
  expect(parseServerMessage(raw)).toEqual({
    type: "SCENE_UPDATE",
    payload: { elements: [element] },
  })
})

test("SCENE_INIT parses on the client and has no client-side counterpart", () => {
  const raw = '{"type":"SCENE_INIT","payload":{"elements":[]}}'
  expect(parseServerMessage(raw)).toEqual({
    type: "SCENE_INIT",
    payload: { elements: [] },
  })
  // The server never accepts one: a peer cannot declare the room's scene.
  expect(parseClientMessage(raw)).toBeNull()
})

test("an element missing what the merge rule reads rejects the whole delta", () => {
  const bad = (element: unknown) =>
    JSON.stringify({ type: "SCENE_UPDATE", payload: { elements: [element] } })

  expect(parseClientMessage('{"type":"SCENE_UPDATE","payload":{}}')).toBeNull()
  expect(parseClientMessage(bad({ id: "rect", version: 1 }))).toBeNull()
  expect(parseClientMessage(bad({ version: 1, versionNonce: 1 }))).toBeNull()
  expect(
    parseClientMessage(bad({ id: "rect", version: "1", versionNonce: 1 })),
  ).toBeNull()
  expect(
    parseClientMessage(
      bad({ id: "rect", version: 1, versionNonce: 1, index: 3 }),
    ),
  ).toBeNull()
  // A partly-valid delta is refused outright — half-applied is worse than none.
  expect(
    parseClientMessage(
      JSON.stringify({
        type: "SCENE_UPDATE",
        payload: {
          elements: [{ id: "a", version: 1, versionNonce: 1 }, { id: "b" }],
        },
      }),
    ),
  ).toBeNull()
})

test("the heartbeat round-trips as the smallest frame the protocol has", () => {
  expect(parseClientMessage('{"type":"PING","payload":{}}')).toEqual({
    type: "PING",
    payload: {},
  })
  expect(parseServerMessage('{"type":"PONG","payload":{}}')).toEqual({
    type: "PONG",
    payload: {},
  })
})

test("the server refuses a version or nonce no Excalidraw client makes, so no peer can pin an element", () => {
  const update = (version: number, versionNonce: number) =>
    JSON.stringify({
      type: "SCENE_UPDATE",
      payload: { elements: [{ id: "rect", version, versionNonce }] },
    })

  for (const [version, versionNonce] of [
    [Number.MAX_VALUE, 1],
    [2 ** 53, 1],
    [1.5, 1],
    [1, -1],
    [1, -Number.MAX_VALUE],
    [1, 0.5],
  ]) {
    expect(parseClientMessage(update(version, versionNonce))).toBeNull()
    // The client takes them: the Room may hold an old stored scene.
    expect(parseServerMessage(update(version, versionNonce))).not.toBeNull()
  }
  // Excalidraw counts versions up from 1 and draws nonces from [0, 2^31).
  expect(parseClientMessage(update(2 ** 31, 0))).not.toBeNull()
  expect(parseClientMessage(update(1, 2 ** 31 - 1))).not.toBeNull()
})

test("the server refuses a deeply nested element, which could never be serialized again", () => {
  const nested = (depth: number) => "[".repeat(depth) + "]".repeat(depth)
  const update = (depth: number) =>
    `{"type":"SCENE_UPDATE","payload":{"elements":[{"id":"p","version":1,"versionNonce":1,"x":${nested(depth)}}]}}`

  expect(parseClientMessage(update(60))).not.toBeNull()
  expect(parseClientMessage(update(100))).toBeNull()
  expect(parseClientMessage(update(100_000))).toBeNull()
})
