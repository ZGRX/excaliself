// What an export needs besides the elements: the drawing's image files and
// the appState saved with its scene.

import { and, eq, inArray } from "drizzle-orm"
import type { Db } from "@/db"
import { drawingFiles } from "@/db/schema"
import { bytesToDataUrl } from "@/features/drawings/file-bytes"

/** An image file, as Excalidraw's BinaryFiles hold it. */
export type SceneFile = {
  id: string
  mimeType: string
  dataURL: string
  created: number
}

/** The stored files of the scene's live image elements, by fileId. */
export async function loadImageFiles(
  db: Db,
  drawingId: string,
  elements: readonly Record<string, unknown>[],
): Promise<Map<string, SceneFile>> {
  const fileIds = [
    ...new Set(
      elements.flatMap((element) =>
        element.type === "image" &&
        !element.isDeleted &&
        typeof element.fileId === "string"
          ? [element.fileId]
          : [],
      ),
    ),
  ]
  if (fileIds.length === 0) return new Map()
  const rows = await db
    .select({
      fileId: drawingFiles.fileId,
      mimeType: drawingFiles.mimeType,
      bytes: drawingFiles.bytes,
      createdAt: drawingFiles.createdAt,
    })
    .from(drawingFiles)
    .where(
      and(
        eq(drawingFiles.drawingId, drawingId),
        inArray(drawingFiles.fileId, fileIds),
      ),
    )
  return new Map(
    rows.map(({ fileId, mimeType, bytes, createdAt }) => [
      fileId,
      {
        id: fileId,
        mimeType,
        dataURL: bytesToDataUrl(mimeType, Buffer.from(bytes)),
        created: createdAt.getTime(),
      },
    ]),
  )
}

/** The appState saved with the scene; empty when there is none. */
export function storedAppState(data: string | null): Record<string, unknown> {
  try {
    const appState = JSON.parse(data ?? "")?.appState
    return typeof appState === "object" && appState !== null ? appState : {}
  } catch {
    return {}
  }
}

/** The canvas color saved with the scene; white when there is none. */
export function sceneBackgroundColor(data: string | null) {
  const color = storedAppState(data).viewBackgroundColor
  return typeof color === "string" && color ? color : "#ffffff"
}
