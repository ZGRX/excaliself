// Room image bytes go over HTTP, not the socket: the row exists before the
// element syncs as `saved`, so peers always find bytes here. Shared by both
// entries under `src/routes/api/`: a Share link's token and a Team Drawing's id.

import { db } from "@/db"
import { socketIpOf } from "@/lib/client-ip"
import { fromOwnOrigin } from "@/lib/same-origin"
import { loadRoomFile, saveRoomFile } from "./room-file-store"
import { MAX_UPLOAD_BODY_BYTES, parseFileUpload } from "./room-files"
import type { RoomJoin } from "./room-token"
import { allowImageUpload } from "./upload-rate-limit"

// One refusal for every reason, so it never leaks whether the drawing exists.
const unauthorized = () =>
  new Response("Unauthorized", {
    status: 401,
    headers: { "cache-control": "no-store" },
  })

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Caps the bytes read; `content-length` is optional, so a chunked body could
// otherwise stream unbounded into memory.
async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<{ status: "ok"; text: string } | { status: "too-large" | "empty" }> {
  const stream = request.body
  if (!stream) return { status: "empty" }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) return { status: "too-large" }
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    return { status: "empty" }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { status: "ok", text: text + decoder.decode() }
}

/**
 * GET and POST for one entry's image route. `resolve` is the entry's join
 * check, so images open to exactly who the socket admits. No failed-lookup
 * budget here: a late joiner fetches one image each, which would starve their
 * reconnect.
 */
export function roomFileHandlers<Params extends { fileId: string }>(
  resolve: (request: Request, params: Params) => Promise<RoomJoin>,
) {
  type Input = { request: Request; params: Params }

  async function resolveRoom({ request, params }: Input) {
    const join = await resolve(request, params)
    return join.status === "ok" ? join.roomId : null
  }

  async function getRoomFile(input: Input): Promise<Response> {
    const { params } = input
    const roomId = await resolveRoom(input)
    if (!roomId) return unauthorized()

    const file = await loadRoomFile(db, roomId, params.fileId)
    if (!file) return new Response("Not Found", { status: 404 })

    return Response.json(file, {
      // `fileId` is a content hash, but the blob is room-scoped: private only.
      headers: { "cache-control": "private, max-age=31536000, immutable" },
    })
  }

  async function postRoomFile(input: Input): Promise<Response> {
    const { request, params } = input
    // The cookie rides along from sibling subdomains too; only reads are CORS-safe.
    if (!fromOwnOrigin(request))
      return new Response("Forbidden", { status: 403 })
    // Cheapest refusal first; the stream is capped again for undeclared bodies.
    const declaredLength = Number(request.headers.get("content-length") ?? "")
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_UPLOAD_BODY_BYTES
    )
      return new Response("Payload Too Large", { status: 413 })

    const roomId = await resolveRoom(input)
    if (!roomId) return unauthorized()

    // The budget is per IP per room, so it needs the resolved room.
    if (
      !allowImageUpload({
        headers: request.headers,
        socketIp: socketIpOf(request),
        roomId,
      })
    )
      return new Response("Too Many Requests", { status: 429 })

    const read = await readCappedBody(request, MAX_UPLOAD_BODY_BYTES)
    if (read.status === "too-large")
      return new Response("Payload Too Large", { status: 413 })

    const body = read.status === "ok" ? parseJson(read.text) : null
    const parsed = parseFileUpload(params.fileId, body)
    if (parsed.status === "too-large")
      return new Response("Payload Too Large", { status: 413 })
    if (parsed.status === "invalid")
      return new Response("Bad Request", { status: 400 })

    // 409, not 413: the image is fine, the drawing is full.
    const saved = await saveRoomFile(db, roomId, parsed.file)
    if (saved === "full")
      return new Response("Drawing image limit reached", { status: 409 })
    return new Response(null, { status: 204 })
  }

  return { getRoomFile, postRoomFile }
}
