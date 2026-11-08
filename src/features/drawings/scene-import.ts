// Turns a scene from outside (an Excalidraw+ scene, a dropped .excalidraw
// file) into a stored drawing.

import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Db } from "@/db"
import { drawingFiles, drawings, type Space } from "@/db/schema"
import {
  MAX_DRAWING_IMAGE_BYTES,
  parseFileUpload,
} from "@/features/collab/room-files"
import { assertFolderTarget } from "@/features/folders/ownership"
import { lockFolderTree, type Tx } from "@/features/folders/tree-lock"
import { dataUrlToBytes } from "./file-bytes"
import { referencedFileIds } from "./scene-write"
import { sceneText } from "./search"

/** A scene in the .excalidraw file shape, images inline as data URLs. */
export const sceneContentSchema = z.object({
  type: z.string().optional(),
  version: z.number().optional(),
  source: z.string().optional(),
  elements: z.array(z.record(z.string(), z.unknown())),
  appState: z.record(z.string(), z.unknown()).catch({}),
  // Entries are checked one by one on import, so one bad file drops only itself.
  files: z.record(z.string(), z.unknown()).catch({}),
  filesFailedToEmbed: z.array(z.string()).catch([]),
})

export type SceneContent = z.infer<typeof sceneContentSchema>

export type PreparedScene = {
  data: string
  searchText: string
  files: { fileId: string; mimeType: string; bytes: Buffer }[]
  skippedImages: number
}

/**
 * The scene as excaliself stores it. Only images live elements use are kept,
 * up to the drawing's image budget; each image left without bytes is marked
 * `error`, so every canvas shows the placeholder instead of waiting for it.
 */
export function prepareScene(content: SceneContent): PreparedScene {
  const failed = new Set(content.filesFailedToEmbed)
  let budget = MAX_DRAWING_IMAGE_BYTES
  const files: PreparedScene["files"] = []
  for (const fileId of referencedFileIds(content.elements)) {
    if (failed.has(fileId)) continue
    const entry = content.files[fileId] as { dataURL?: unknown } | undefined
    // The drawing's whole budget is the only cap: imports may carry bigger
    // images than a live upload here, and a stored one loads at any size.
    const parsed = parseFileUpload(
      fileId,
      { dataUrl: entry?.dataURL },
      MAX_DRAWING_IMAGE_BYTES,
    )
    if (parsed.status !== "ok") continue
    const bytes = dataUrlToBytes(parsed.file.dataUrl)
    if (bytes.length > budget) continue
    budget -= bytes.length
    files.push({ fileId, mimeType: parsed.file.mimeType, bytes })
  }

  const stored = new Set(files.map((file) => file.fileId))
  const elements = content.elements.map((element) =>
    element.type === "image" &&
    typeof element.fileId === "string" &&
    !stored.has(element.fileId)
      ? { ...element, status: "error" }
      : element,
  )
  const live = referencedFileIds(content.elements)

  return {
    data: JSON.stringify({
      type: content.type ?? "excalidraw",
      version: content.version ?? 2,
      source: content.source ?? "https://excalidraw.com",
      elements,
      appState: content.appState,
    }),
    searchText: sceneText(elements),
    files,
    skippedImages: [...live].filter((fileId) => !stored.has(fileId)).length,
  }
}

type DrawingRow = {
  name: string
  folderId: string | null
  space: Space
  createdBy: string
  createdAt: Date
  updatedAt: Date
  excalidrawPlusId?: string
}

/** Inserts a prepared scene as a new drawing, with its images. */
export async function insertPreparedDrawing(
  tx: Tx,
  prepared: PreparedScene,
  row: DrawingRow,
): Promise<string> {
  const id = randomUUID()
  await tx.insert(drawings).values({
    id,
    ...row,
    name: row.name.trim() || "Untitled",
    data: prepared.data,
    searchText: prepared.searchText,
  })
  if (prepared.files.length > 0) {
    const now = new Date()
    await tx.insert(drawingFiles).values(
      prepared.files.map((file) => ({
        id: randomUUID(),
        drawingId: id,
        ...file,
        createdAt: now,
      })),
    )
  }
  return id
}

/** Imports one dropped file's scene into a folder, or the root of `space`. */
export async function importDrawing(
  db: Db,
  userId: string,
  input: {
    name: string
    folderId: string | null
    space: Space
    lastModified: number
    content: SceneContent
  },
): Promise<{ id: string; space: Space; skippedImages: number }> {
  const prepared = prepareScene(input.content)
  return db.transaction(async (tx) => {
    await lockFolderTree(tx, "place")
    // Inside a folder the drawing takes the folder's space.
    const space = input.folderId
      ? await assertFolderTarget(tx, userId, input.folderId)
      : input.space
    const now = new Date()
    const importedAt = new Date(Math.min(input.lastModified, now.getTime()))
    const id = await insertPreparedDrawing(tx, prepared, {
      name: input.name,
      folderId: input.folderId,
      space,
      createdBy: userId,
      createdAt: importedAt,
      updatedAt: importedAt,
    })
    return { id, space, skippedImages: prepared.skippedImages }
  })
}
