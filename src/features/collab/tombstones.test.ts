// @vitest-environment node
import { beforeAll, expect, test } from "vitest"
import { demoAdmin } from "@/db/demo-content"
import type { Db } from "@/db/index"
import { createPreviewDb } from "@/db/preview"
import { drawingFiles, drawings } from "@/db/schema"
import { createShareLink, resolveShareVisit } from "@/features/shares/store"
import type { ServerMessage } from "./protocol"
import {
  createRoomRegistry,
  joinRoom,
  type RoomPeer,
  receiveFromPeer,
} from "./room-session"
import { loadRoomScene, saveRoomScene } from "./scene-store"

// Deleted content in a Team drawing must not reach a guest who joins later.

const DAY = 24 * 60 * 60 * 1000

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
}, 30_000)

const deletedText = (id: string, updated: number) => ({
  id,
  type: "text",
  text: `${id}-secret`,
  originalText: `${id}-secret`,
  version: 3,
  versionNonce: 1,
  isDeleted: true,
  updated,
})

const live = { id: "live", type: "rectangle", version: 1, versionNonce: 1 }

async function teamDrawing(id: string, extra: unknown[] = []) {
  const now = Date.now()
  await db.insert(drawings).values({
    id,
    name: id,
    space: "team",
    createdBy: demoAdmin.id,
    data: JSON.stringify({
      elements: [
        live,
        deletedText("old", now - 30 * DAY),
        deletedText("recent", now - 60 * 60 * 1000),
        ...extra,
      ],
    }),
  })
}

const roomFor = () =>
  createRoomRegistry(
    (id) => loadRoomScene(db, id),
    (id, elements) => saveRoomScene(db, id, elements),
  )

function recordingPeer(id: string) {
  const sent: ServerMessage[] = []
  const published: ServerMessage[] = []
  const peer: RoomPeer = {
    id,
    send: (data) => void sent.push(data),
    publish: (_topic, data) => void published.push(data),
    subscribe: () => {},
    close: () => {},
  }
  return { peer, sent, published }
}

const ids = (elements: { id: string }[]) => elements.map((el) => el.id)

test("an anyone-link visit carries no deleted elements or their images", async () => {
  const image = (id: string, isDeleted: boolean) => ({
    id,
    type: "image",
    fileId: `${id}-file`,
    status: "saved",
    version: 1,
    versionNonce: 1,
    isDeleted,
    updated: Date.now() - 30 * DAY,
  })
  await teamDrawing("visit", [image("shown", false), image("gone", true)])
  await db.insert(drawingFiles).values(
    ["shown", "gone"].map((id) => ({
      id,
      drawingId: "visit",
      fileId: `${id}-file`,
      mimeType: "image/png",
      bytes: Buffer.from("png"),
    })),
  )
  const link = await createShareLink(db, demoAdmin.id, "visit", "anyone")
  if (!link) throw new Error("no link")

  const visit = await resolveShareVisit(db, link.token, async () => false)

  if (visit.status !== "ok") throw new Error(visit.status)
  expect(ids(JSON.parse(visit.drawing.data).elements)).toEqual([
    "live",
    "shown",
  ])
  expect(visit.files.map((file) => file.fileId)).toEqual(["shown-file"])
})

test("SCENE_INIT leaves out month-old tombstones but keeps recent ones", async () => {
  await teamDrawing("init")
  const guest = recordingPeer("guest")

  await joinRoom(roomFor(), "init", guest.peer, {
    userId: null,
    sessionId: null,
    displayName: "g",
  })

  const init = guest.sent.find((m) => m.type === "SCENE_INIT")
  expect(init?.type === "SCENE_INIT" && ids(init.payload.elements)).toEqual([
    "live",
    "recent",
  ])
})

// A tab asleep since before the delete reconnects with the element as it was,
// to a Room loaded fresh from a save. Peers who joined since never got the
// month-old tombstone, so it is not published to them.
test("a tab with a pre-delete copy is corrected after a save and reload", async () => {
  await teamDrawing("converge")
  await saveRoomScene(
    db,
    "converge",
    (await loadRoomScene(db, "converge")).elements,
  )
  const registry = roomFor()
  const member = recordingPeer("member")
  await joinRoom(registry, "converge", member.peer, {
    userId: demoAdmin.id,
    sessionId: "s:member",
    displayName: null,
  })

  const stale = ["recent", "old"].map((id) => ({
    id,
    type: "text",
    text: `${id}-secret`,
    version: 2,
    versionNonce: 5,
  }))
  await receiveFromPeer(
    registry,
    "converge",
    member.peer,
    JSON.stringify({ type: "SCENE_UPDATE", payload: { elements: stale } }),
  )

  const correction = member.sent.at(-1)
  expect(correction?.type).toBe("SCENE_UPDATE")
  expect(
    correction?.type === "SCENE_UPDATE" &&
      correction.payload.elements.map((el) => [el.id, el.isDeleted]),
  ).toEqual([
    ["recent", true],
    ["old", true],
  ])
  const broadcast = member.published.at(-1)
  expect(
    broadcast?.type === "SCENE_UPDATE" && ids(broadcast.payload.elements),
  ).toEqual(["recent"])
})

// A guest who kept element ids could send a stale copy on purpose.
test("a guest with a pre-delete copy gets only recent tombstones back", async () => {
  await teamDrawing("guest-stale")
  const registry = roomFor()
  const guest = recordingPeer("guest")
  await joinRoom(registry, "guest-stale", guest.peer, {
    userId: null,
    sessionId: null,
    displayName: "g",
  })

  const stale = ["recent", "old"].map((id) => ({
    id,
    type: "text",
    version: 2,
    versionNonce: 5,
  }))
  await receiveFromPeer(
    registry,
    "guest-stale",
    guest.peer,
    JSON.stringify({ type: "SCENE_UPDATE", payload: { elements: stale } }),
  )

  const correction = guest.sent.at(-1)
  expect(
    correction?.type === "SCENE_UPDATE" && ids(correction.payload.elements),
  ).toEqual(["recent"])
})
