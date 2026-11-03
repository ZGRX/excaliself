// Share-link persistence, kept out of server.ts so tests can use a fake db.

import { randomBytes, randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import type { Db } from "@/db"
import {
  drawingFiles,
  drawings,
  type Space,
  shareRedirects,
  shares,
} from "@/db/schema"
import { bytesToDataUrl } from "@/features/drawings/file-bytes"
import { referencedFileIds } from "@/features/drawings/scene-write"
import { accessibleTo } from "@/features/spaces/access"
import { resolveShareAccess, type ShareAudience } from "./access"

/** 256-bit hex token. */
export function mintShareToken() {
  return randomBytes(32).toString("hex")
}

// Throws the same "not found" as a missing id, so private drawings can't be
// probed. Inside a transaction, the share lock makes a concurrent move to Team
// wait for this write, or makes this read see the moved row.
async function requireAccessibleLiveDrawing(
  db: Db,
  userId: string,
  drawingId: string,
) {
  const [drawing] = await db
    .select({ space: drawings.space })
    .from(drawings)
    .where(
      and(
        eq(drawings.id, drawingId),
        accessibleTo(drawings, userId),
        isNull(drawings.deletedAt),
      ),
    )
    .for("share")
  if (!drawing) throw new Error("Drawing not found")
  return drawing
}

// Every member already opens a Team drawing, so a members link grants nothing.
function requireAudienceFits(space: Space, audience: ShareAudience) {
  if (space === "team" && audience === "members")
    throw new Error("Team drawings take only guest links")
}

const shareColumns = {
  token: shares.token,
  audience: shares.audience,
  createdAt: shares.createdAt,
}

/** The live link for a drawing the caller can access, or null when unshared. */
export async function getShareLink(db: Db, userId: string, drawingId: string) {
  const [share] = await db
    .select(shareColumns)
    .from(shares)
    .innerJoin(drawings, eq(shares.drawingId, drawings.id))
    .where(and(eq(shares.drawingId, drawingId), accessibleTo(drawings, userId)))
  return share ?? null
}

export async function createShareLink(
  db: Db,
  userId: string,
  drawingId: string,
  audience: ShareAudience,
) {
  // One transaction with the space check, so a move to Team can't slip in
  // between and leave a Team drawing with a members link.
  const created = await db.transaction(async (tx) => {
    const { space } = await requireAccessibleLiveDrawing(tx, userId, drawingId)
    requireAudienceFits(space, audience)
    const [row] = await tx
      .insert(shares)
      .values({
        id: randomUUID(),
        token: mintShareToken(),
        drawingId,
        audience,
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: shares.drawingId })
      .returning(shareColumns)
    return row
  })
  // Return an existing link unchanged: only setShareLinkAudience evicts guests.
  return created ?? getShareLink(db, userId, drawingId)
}

export async function stopSharingDrawing(
  db: Db,
  userId: string,
  drawingId: string,
) {
  await requireAccessibleLiveDrawing(db, userId, drawingId)
  await db.delete(shares).where(eq(shares.drawingId, drawingId))
}

export async function regenerateShareLink(
  db: Db,
  userId: string,
  drawingId: string,
) {
  await requireAccessibleLiveDrawing(db, userId, drawingId)
  const updated = await db
    .update(shares)
    .set({ token: mintShareToken() })
    .where(eq(shares.drawingId, drawingId))
    .returning(shareColumns)
  if (updated.length === 0) throw new Error("Share not found")
  return updated[0]
}

export async function setShareLinkAudience(
  db: Db,
  userId: string,
  drawingId: string,
  audience: ShareAudience,
) {
  const updated = await db.transaction(async (tx) => {
    const { space } = await requireAccessibleLiveDrawing(tx, userId, drawingId)
    requireAudienceFits(space, audience)
    return tx
      .update(shares)
      .set({ audience })
      .where(eq(shares.drawingId, drawingId))
      .returning(shareColumns)
  })
  if (updated.length === 0) throw new Error("Share not found")
  return updated[0]
}

/** Raw token lookup; resolveShareAccess decides whether it grants access. */
export async function resolveShareByToken(db: Db, token: string) {
  const [row] = await db
    .select({
      audience: shares.audience,
      drawing: {
        id: drawings.id,
        name: drawings.name,
        data: drawings.data,
        deletedAt: drawings.deletedAt,
      },
    })
    .from(shares)
    .innerJoin(drawings, eq(shares.drawingId, drawings.id))
    .where(eq(shares.token, token))
  return row ?? null
}

/** Lean lookup for the ws upgrade (runs on every reconnect): no scene JSON. */
export async function resolveShareForRoom(db: Db, token: string) {
  const [row] = await db
    .select({
      audience: shares.audience,
      drawing: { id: drawings.id, deletedAt: drawings.deletedAt },
    })
    .from(shares)
    .innerJoin(drawings, eq(shares.drawingId, drawings.id))
    .where(eq(shares.token, token))
  return row ?? null
}

export type ShareResolution =
  | { status: "dead" }
  /** A members link the move to Team dropped; only members get this arm. */
  | { status: "moved"; drawingId: string }
  | { status: "signin"; drawingName: string }
  | {
      status: "ok"
      audience: ShareAudience
      drawing: { id: string; name: string; data: string }
      files: { fileId: string; mimeType: string; dataUrl: string }[]
    }

/**
 * A guest's first paint without deleted elements or their images; the Room
 * sends recent tombstones itself. Null when the scene can't be read.
 */
function liveScene(data: string) {
  let scene: { elements?: unknown } | null
  try {
    scene = JSON.parse(data)
  } catch {
    return null
  }
  if (!Array.isArray(scene?.elements)) return null
  const elements = (
    scene.elements as (Record<string, unknown> | null)[]
  ).filter(
    (element): element is Record<string, unknown> =>
      element !== null && !element.isDeleted,
  )
  return {
    data: JSON.stringify({ ...scene, elements }),
    fileIds: referencedFileIds(elements),
  }
}

/** Resolves a /share/$token visit. "dead" never hints the token existed. */
export async function resolveShareVisit(
  db: Db,
  token: string,
  hasSession: () => Promise<boolean>,
): Promise<ShareResolution> {
  const resolved = await resolveShareByToken(db, token)
  // A members link left by a move to Team sends signed-in members on to the
  // drawing; anyone else gets what a dead members link gives.
  if (!resolved) {
    const [moved] = await db
      .select({ drawingId: shareRedirects.drawingId })
      .from(shareRedirects)
      .where(eq(shareRedirects.token, token))
    return moved && (await hasSession())
      ? { status: "moved", drawingId: moved.drawingId }
      : { status: "dead" }
  }

  const access = resolveShareAccess({
    share: resolved,
    hasSession: resolved?.audience === "members" ? await hasSession() : false,
  })

  if (access === "dead") return { status: "dead" }
  if (access === "signin")
    return { status: "signin", drawingName: resolved.drawing.name }

  const live = liveScene(resolved.drawing.data)
  const files = await db
    .select({
      fileId: drawingFiles.fileId,
      mimeType: drawingFiles.mimeType,
      bytes: drawingFiles.bytes,
    })
    .from(drawingFiles)
    .where(eq(drawingFiles.drawingId, resolved.drawing.id))

  return {
    status: "ok",
    audience: resolved.audience,
    drawing: {
      id: resolved.drawing.id,
      name: resolved.drawing.name,
      data: live?.data ?? resolved.drawing.data,
    },
    files: files
      .filter((file) => !live || live.fileIds.has(file.fileId))
      .map(({ bytes, ...file }) => ({
        ...file,
        dataUrl: bytesToDataUrl(file.mimeType, bytes),
      })),
  }
}
