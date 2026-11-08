// @vitest-environment node
import { expect, test } from "vitest"
import { demoAdmin } from "@/db/demo-content"
import { createPreviewDb } from "@/db/preview"
import { drawingFiles, drawings } from "@/db/schema"
import { loadImageFiles } from "./scene-data"

test("loads only the files of the scene's live images, as data URLs", async () => {
  const db = await createPreviewDb()
  await db.insert(drawings).values({
    id: "photos",
    name: "Photos",
    space: "private",
    createdBy: demoAdmin.id,
  })
  const createdAt = new Date("2026-01-02T03:04:05Z")
  await db.insert(drawingFiles).values(
    ["kept", "deleted", "unused"].map((fileId) => ({
      id: `row-${fileId}`,
      drawingId: "photos",
      fileId,
      mimeType: "image/png",
      bytes: Buffer.from([1, 2, 3]),
      createdAt,
    })),
  )
  const files = await loadImageFiles(db, "photos", [
    { id: "a", type: "image", fileId: "kept" },
    { id: "b", type: "image", fileId: "deleted", isDeleted: true },
  ])
  expect([...files.values()]).toEqual([
    {
      id: "kept",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AQID",
      created: createdAt.getTime(),
    },
  ])
}, 30_000)
