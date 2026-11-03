// @vitest-environment node
import { eq } from "drizzle-orm"
import { expect, test } from "vitest"
import { createPreviewDb } from "@/db/preview"
import { drawings } from "@/db/schema"
import { saveRoomScene } from "./scene-store"

// Postgres text refuses U+0000, so one in a guest's text failed every flush.
test("saveRoomScene stores a text element that holds U+0000", async () => {
  const db = await createPreviewDb()
  const [drawing] = await db.select({ id: drawings.id }).from(drawings).limit(1)

  await saveRoomScene(db, drawing.id, [
    {
      id: "t1",
      type: "text",
      version: 1,
      versionNonce: 1,
      text: "hi",
      originalText: "hi\u0000 there",
    },
  ])

  const [saved] = await db
    .select({ data: drawings.data, searchText: drawings.searchText })
    .from(drawings)
    .where(eq(drawings.id, drawing.id))
  expect(saved.searchText).toBe("hi there")
  expect(
    JSON.parse(saved.data).elements.find((e: { id: string }) => e.id === "t1")
      .originalText,
  ).toBe("hi\u0000 there")
}, 30_000)
