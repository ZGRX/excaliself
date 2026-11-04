// @vitest-environment node
import { eq } from "drizzle-orm"
import { beforeAll, expect, test } from "vitest"
import { demoAdmin } from "@/db/demo-content"
import type { Db } from "@/db/index"
import { createPreviewDb } from "@/db/preview"
import { drawingFiles, drawings, users } from "@/db/schema"
import { MAX_DRAWING_IMAGE_BYTES } from "@/features/collab/room-files"
import { importDrawing, prepareScene, type SceneContent } from "./scene-import"

const PNG = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`

const image = (fileId: string, extra: Record<string, unknown> = {}) => ({
  type: "image",
  id: `el-${fileId}`,
  fileId,
  status: "saved",
  ...extra,
})

const content = (
  elements: Record<string, unknown>[],
  files: Record<string, unknown> = {},
  filesFailedToEmbed: string[] = [],
): SceneContent => ({
  elements,
  appState: { viewBackgroundColor: "#fff" },
  files,
  filesFailedToEmbed,
})

test("stores only live images within the budget and marks the rest as errors", () => {
  const big = `data:image/png;base64,${Buffer.alloc(MAX_DRAWING_IMAGE_BYTES).toString("base64")}`
  const prepared = prepareScene(
    content(
      [
        image("kept"),
        image("deleted", { isDeleted: true }),
        image("missing"),
        image("failed"),
        image("too-big"),
        { type: "text", originalText: "hello  world" },
      ],
      {
        kept: { mimeType: "image/png", dataURL: PNG },
        deleted: { mimeType: "image/png", dataURL: PNG },
        failed: { mimeType: "image/png", dataURL: PNG },
        "too-big": { mimeType: "image/png", dataURL: big },
      },
      ["failed"],
    ),
  )

  expect(prepared.files.map((file) => file.fileId)).toEqual(["kept"])
  expect(prepared.skippedImages).toBe(3)
  expect(prepared.searchText).toBe("hello world")
  const statuses = Object.fromEntries(
    JSON.parse(prepared.data).elements.map(
      (el: { fileId?: string; status?: string }) => [el.fileId, el.status],
    ),
  )
  expect(statuses).toMatchObject({
    kept: "saved",
    missing: "error",
    failed: "error",
    "too-big": "error",
  })
})

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
}, 30_000)

test("a dropped file lands in the folder's space, with its images", async () => {
  await importDrawing(db, demoAdmin.id, {
    name: "Dropped",
    folderId: "demo-architecture",
    space: "private",
    lastModified: Date.now(),
    content: content([image("img")], {
      img: { mimeType: "image/png", dataURL: PNG },
    }),
  })

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.name, "Dropped"))
  expect(drawing).toMatchObject({
    folderId: "demo-architecture",
    space: "team",
    createdBy: demoAdmin.id,
  })
  const files = await db
    .select({ fileId: drawingFiles.fileId })
    .from(drawingFiles)
    .where(eq(drawingFiles.drawingId, drawing.id))
  expect(files).toEqual([{ fileId: "img" }])
})

test("a dropped file keeps its last modified date for both drawing timestamps", async () => {
  const lastModified = new Date("2020-01-02T03:04:05.000Z").getTime()
  await importDrawing(db, demoAdmin.id, {
    name: "Old file",
    folderId: null,
    space: "private",
    lastModified,
    content: content([]),
  })

  const [drawing] = await db
    .select({ createdAt: drawings.createdAt, updatedAt: drawings.updatedAt })
    .from(drawings)
    .where(eq(drawings.name, "Old file"))
  expect(drawing.createdAt.getTime()).toBe(lastModified)
  expect(drawing.updatedAt.getTime()).toBe(lastModified)
})

test("a future file date is clamped to the import time", async () => {
  const before = Date.now()
  await importDrawing(db, demoAdmin.id, {
    name: "Future file",
    folderId: null,
    space: "private",
    lastModified: before + 24 * 60 * 60 * 1000,
    content: content([]),
  })
  const after = Date.now()

  const [drawing] = await db
    .select({ createdAt: drawings.createdAt, updatedAt: drawings.updatedAt })
    .from(drawings)
    .where(eq(drawings.name, "Future file"))
  expect(drawing.createdAt.getTime()).toBeGreaterThanOrEqual(before)
  expect(drawing.createdAt.getTime()).toBeLessThanOrEqual(after)
  expect(drawing.updatedAt).toEqual(drawing.createdAt)
})

test("a dropped file can't go into someone else's private folder", async () => {
  await db
    .insert(users)
    .values({ id: "member", email: "member@example.com", name: "Member" })

  await expect(
    importDrawing(db, "member", {
      name: "Sneaky",
      folderId: "demo-product",
      space: "private",
      lastModified: Date.now(),
      content: content([]),
    }),
  ).rejects.toThrow("Folder not found")
})
