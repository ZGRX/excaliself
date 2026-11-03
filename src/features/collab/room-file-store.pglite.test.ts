// @vitest-environment node
import { eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { createPreviewDb } from "@/db/preview"
import { drawingFiles, drawings } from "@/db/schema"
import { saveRoomFile, storedImageBytes } from "./room-file-store"
import { MAX_DRAWING_IMAGE_BYTES, MAX_IMAGE_BYTES } from "./room-files"

// A guest can fire many uploads at once; together they must still fit the cap.
test("parallel uploads never take a drawing over its image cap", async () => {
  const db = await createPreviewDb()
  const [drawing] = await db.select({ id: drawings.id }).from(drawings).limit(1)
  await db.delete(drawingFiles).where(eq(drawingFiles.drawingId, drawing.id))
  const dataUrl = `data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES).toString("base64")}`

  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      saveRoomFile(db, drawing.id, {
        fileId: `f${i}`,
        mimeType: "image/png",
        dataUrl,
      }),
    ),
  )

  expect(results.filter((r) => r === "stored")).toHaveLength(10)
  expect(await storedImageBytes(db, drawing.id)).toBe(MAX_DRAWING_IMAGE_BYTES)
}, 30_000)
