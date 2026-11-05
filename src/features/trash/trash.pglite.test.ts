// @vitest-environment node
import { eq } from "drizzle-orm"
import { beforeAll, expect, test } from "vitest"
import { demoAdmin } from "@/db/demo-content"
import type { Db } from "@/db/index"
import { createPreviewDb } from "@/db/preview"
import { drawings, folders, users } from "@/db/schema"
import { trashDrawingUnit, trashFolderUnit } from "./trash"

const member = { id: "member-b", email: "b@example.com", name: "B" }

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
  await db.insert(users).values(member)
}, 30_000)

const trashRootOf = async (id: string) =>
  (
    await db
      .select({ trashRootId: drawings.trashRootId })
      .from(drawings)
      .where(eq(drawings.id, id))
  )[0]?.trashRootId

test("a member can't trash another member's Private drawing", async () => {
  await db.insert(drawings).values({
    id: "admins-private",
    name: "Private",
    space: "private",
    createdBy: demoAdmin.id,
  })

  await expect(
    trashDrawingUnit(db, member.id, "admins-private"),
  ).rejects.toThrow("Drawing not found")
  expect(await trashRootOf("admins-private")).toBeNull()
}, 30_000)

// The returned ids are the Rooms the caller ends.
test("a folder sweeps only live drawings; earlier trash keeps its unit", async () => {
  await db.insert(folders).values([
    { id: "outer", name: "Outer", space: "team", createdBy: member.id },
    {
      id: "inner",
      name: "Inner",
      space: "team",
      createdBy: member.id,
      parentId: "outer",
    },
  ])
  await db.insert(drawings).values([
    { id: "live", name: "Live", space: "team", folderId: "inner" },
    { id: "earlier", name: "Earlier", space: "team", folderId: "inner" },
  ])
  await trashDrawingUnit(db, member.id, "earlier")

  expect(await trashFolderUnit(db, member.id, "outer")).toEqual(["live"])
  expect(await trashRootOf("live")).toBe("outer")
  expect(await trashRootOf("earlier")).toBe("earlier")
}, 30_000)
