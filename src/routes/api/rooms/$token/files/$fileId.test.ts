/**
 * The room-scoped image endpoint at its HTTP surface: what a guest actually
 * gets back. The rules it composes are unit-tested next door — this covers
 * the wiring and the status codes the acceptance criteria name.
 */

import { beforeEach, expect, test, vi } from "vitest"
import {
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_BODY_BYTES,
} from "@/features/collab/room-files"
import { IMAGE_UPLOADS_PER_MINUTE } from "@/features/collab/upload-rate-limit"
import { getRoomFile, postRoomFile } from "./$fileId"

vi.mock("@/db", () => ({ db: {} }))

const resolveRoomForToken = vi.hoisted(() => vi.fn())
vi.mock("@/features/collab/room-token", () => ({ resolveRoomForToken }))

const loadRoomFile = vi.hoisted(() => vi.fn())
const saveRoomFile = vi.hoisted(() => vi.fn())
vi.mock("@/features/collab/room-file-store", () => ({
  loadRoomFile,
  saveRoomFile,
}))

const PNG = `data:image/png;base64,${Buffer.alloc(64).toString("base64")}`

const admits = (roomId = "drawing-1") =>
  resolveRoomForToken.mockResolvedValue({
    status: "ok",
    roomId,
    identity: { userId: null, sessionId: null, displayName: null },
  })

const refuses = () =>
  resolveRoomForToken.mockResolvedValue({ status: "refused" })

/** Each test uses an IP of its own — the upload limiter is process-wide. */
let nextIp = 0
const upload = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/rooms/tok/files/file-1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${++nextIp}`,
      ...headers,
    },
    body: JSON.stringify(body),
  })

const params = { token: "tok", fileId: "file-1" }

beforeEach(() => {
  vi.clearAllMocks()
})

test("stores an upload for a token the room admits", async () => {
  admits()

  const response = await postRoomFile({
    request: upload({ dataUrl: PNG }),
    params,
  })

  expect(response.status).toBe(204)
  expect(saveRoomFile).toHaveBeenCalledWith({}, "drawing-1", {
    fileId: "file-1",
    mimeType: "image/png",
    dataUrl: PNG,
  })
})

test("an upload past the drawing's image cap is refused with 409", async () => {
  admits()
  saveRoomFile.mockResolvedValueOnce("full")

  const response = await postRoomFile({
    request: upload({ dataUrl: PNG }),
    params,
  })

  expect(response.status).toBe(409)
})

test("an over-cap image is refused with 413 and never stored", async () => {
  admits()
  const tooBig = `data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64")}`

  // Sent without a content-length so the exact check is the one that answers.
  const response = await postRoomFile({
    request: new Request("https://example.test/api/rooms/tok/files/file-1", {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.${++nextIp}` },
      body: JSON.stringify({ dataUrl: tooBig }),
    }),
    params,
  })

  expect(response.status).toBe(413)
  expect(saveRoomFile).not.toHaveBeenCalled()
})

test("a body too large to hold a legal image is refused before it is read", async () => {
  admits()

  const response = await postRoomFile({
    request: upload({ dataUrl: PNG }, { "content-length": String(50_000_000) }),
    params,
  })

  expect(response.status).toBe(413)
  // Refused ahead of the token lookup — the point of reading content-length.
  expect(resolveRoomForToken).not.toHaveBeenCalled()
})

test("a malformed body is a 400, not a 413", async () => {
  admits()

  const response = await postRoomFile({
    request: upload({ dataUrl: 42 }),
    params,
  })

  expect(response.status).toBe(400)
})

test("more than a minute's uploads from one IP in one room get 429", async () => {
  admits()
  const ip = "198.51.100.200"
  const from = () => upload({ dataUrl: PNG }, { "x-forwarded-for": ip })

  for (let i = 0; i < IMAGE_UPLOADS_PER_MINUTE; i++) {
    expect((await postRoomFile({ request: from(), params })).status).toBe(204)
  }

  expect((await postRoomFile({ request: from(), params })).status).toBe(429)
})

test("an upload on a dead token is refused, and costs no upload budget", async () => {
  refuses()

  const response = await postRoomFile({
    request: upload({ dataUrl: PNG }),
    params,
  })

  expect(response.status).toBe(401)
  expect(saveRoomFile).not.toHaveBeenCalled()
})

test("serves a stored image to a token the room admits", async () => {
  admits()
  loadRoomFile.mockResolvedValue({
    fileId: "file-1",
    mimeType: "image/png",
    dataUrl: PNG,
    created: 7,
  })

  const response = await getRoomFile({
    request: new Request("https://example.test/api/rooms/tok/files/file-1"),
    params,
  })

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({
    fileId: "file-1",
    mimeType: "image/png",
    dataUrl: PNG,
    created: 7,
  })
  expect(loadRoomFile).toHaveBeenCalledWith({}, "drawing-1", "file-1")
})

test("a read on a dead token is refused without touching the database", async () => {
  refuses()

  const response = await getRoomFile({
    request: new Request("https://example.test/api/rooms/tok/files/file-1"),
    params,
  })

  expect(response.status).toBe(401)
  expect(loadRoomFile).not.toHaveBeenCalled()
})

test("a fileId this drawing doesn't hold is a 404", async () => {
  admits()
  loadRoomFile.mockResolvedValue(null)

  const response = await getRoomFile({
    request: new Request("https://example.test/api/rooms/tok/files/file-1"),
    params,
  })

  expect(response.status).toBe(404)
})

test("an undeclared body is capped while it is read, not after", async () => {
  // A chunked upload sends no content-length, so the header pre-check can't
  // see it coming. Without a ceiling on the stream itself, this would buffer
  // in full before the per-image cap got to rule on it.
  admits()
  let pushed = 0
  const flood = new ReadableStream<Uint8Array>({
    pull(controller) {
      pushed += 1
      controller.enqueue(new Uint8Array(1024 * 1024))
    },
  })

  const response = await postRoomFile({
    request: new Request("https://example.test/api/rooms/tok/files/file-1", {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.${++nextIp}` },
      body: flood,
      // @ts-expect-error — node requires this for a streaming body.
      duplex: "half",
    }),
    params,
  })

  expect(response.status).toBe(413)
  expect(saveRoomFile).not.toHaveBeenCalled()
  // It hung up rather than draining an endless sender.
  expect(pushed * 1024 * 1024).toBeLessThan(2 * MAX_UPLOAD_BODY_BYTES)
})

test("an unparseable body is a 400", async () => {
  admits()

  const response = await postRoomFile({
    request: new Request("https://example.test/api/rooms/tok/files/file-1", {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.${++nextIp}` },
      body: "{not json",
    }),
    params,
  })

  expect(response.status).toBe(400)
})
