// @vitest-environment node
import { eq, inArray } from "drizzle-orm"
import { beforeAll, expect, test } from "vitest"
import { demoAdmin } from "@/db/demo-content"
import type { Db } from "@/db/index"
import { createPreviewDb } from "@/db/preview"
import {
  drawings,
  folders,
  shareRedirects,
  shares,
  stars,
  users,
} from "@/db/schema"
import { moveDrawingsToTeam } from "@/features/spaces/move-to-team"
import {
  restoreDrawingUnit,
  restoreDrawingUnits,
} from "@/features/trash/restore"
import { moveDrawingsToFolder, starDrawings, trashDrawings } from "./bulk"

const member = { id: "member-b", email: "b@example.com", name: "B" }

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
  await db.insert(users).values(member)
}, 30_000)

const rows = (ids: string[]) =>
  db
    .select({
      id: drawings.id,
      folderId: drawings.folderId,
      space: drawings.space,
      trashRootId: drawings.trashRootId,
    })
    .from(drawings)
    .where(inArray(drawings.id, ids))
    .orderBy(drawings.id)

const privateOf = (createdBy: string, ...ids: string[]) =>
  ids.map((id) => ({ id, name: id, space: "private" as const, createdBy }))

test("a move to folder is all or nothing, and stays inside one space", async () => {
  await db.insert(folders).values({
    id: "b-folder",
    name: "Folder",
    space: "private",
    createdBy: member.id,
  })
  await db
    .insert(drawings)
    .values([
      ...privateOf(member.id, "b-1", "b-2"),
      { id: "team-1", name: "Team", space: "team", createdBy: member.id },
    ])

  await expect(
    moveDrawingsToFolder(db, member.id, ["b-1", "team-1"], "b-folder"),
  ).rejects.toThrow("Drawing not found")
  expect((await rows(["b-1"]))[0]?.folderId).toBeNull()

  await moveDrawingsToFolder(db, member.id, ["b-1", "b-2"], "b-folder")
  expect((await rows(["b-1", "b-2"])).map((r) => r.folderId)).toEqual([
    "b-folder",
    "b-folder",
  ])
}, 30_000)

test("trash makes each drawing its own unit, and fails whole on one it can't reach", async () => {
  await db
    .insert(drawings)
    .values([
      ...privateOf(member.id, "t-1", "t-2"),
      ...privateOf(demoAdmin.id, "admins"),
    ])

  await expect(trashDrawings(db, member.id, ["t-1", "admins"])).rejects.toThrow(
    "Drawing not found",
  )
  expect((await rows(["t-1"]))[0]?.trashRootId).toBeNull()

  await trashDrawings(db, member.id, ["t-1", "t-2"])
  expect((await rows(["t-1", "t-2"])).map((r) => r.trashRootId)).toEqual([
    "t-1",
    "t-2",
  ])
  // Each restores alone from Trash
  await restoreDrawingUnit(db, member.id, "t-1")
  expect((await rows(["t-1", "t-2"])).map((r) => r.trashRootId)).toEqual([
    null,
    "t-2",
  ])
  // Undo restores together: t-1 is live again, so t-2 stays in the trash
  await expect(
    restoreDrawingUnits(db, member.id, ["t-2", "t-1"]),
  ).rejects.toThrow("Drawing not found")
  expect((await rows(["t-2"]))[0]?.trashRootId).toBe("t-2")
}, 30_000)

test("star and unstar touch only the caller's stars", async () => {
  await db.insert(drawings).values(privateOf(member.id, "s-1", "s-2"))
  const starred = async () =>
    (
      await db
        .select({ drawingId: stars.drawingId })
        .from(stars)
        .where(eq(stars.userId, member.id))
    )
      .map((s) => s.drawingId)
      .filter((id) => id.startsWith("s-"))
      .sort()

  await starDrawings(db, member.id, ["s-1", "s-2"], true)
  expect(await starred()).toEqual(["s-1", "s-2"])
  await starDrawings(db, member.id, ["s-2"], false)
  expect(await starred()).toEqual(["s-1"])
}, 30_000)

test("a move to Team takes only Private drawings, to Team root, and redirects members links", async () => {
  await db.insert(folders).values({
    id: "m-folder",
    name: "Folder",
    space: "private",
    createdBy: member.id,
  })
  await db
    .insert(drawings)
    .values([
      { ...privateOf(member.id, "m-1")[0], folderId: "m-folder" },
      ...privateOf(member.id, "m-2"),
    ])
  await db
    .insert(shares)
    .values({ id: "m-share", token: "m-token", drawingId: "m-1" })

  await expect(
    moveDrawingsToTeam(db, member.id, ["m-1", "team-1"]),
  ).rejects.toThrow("Drawing not found")

  await moveDrawingsToTeam(db, member.id, ["m-1", "m-2"])
  expect(await rows(["m-1", "m-2"])).toMatchObject([
    { space: "team", folderId: null },
    { space: "team", folderId: null },
  ])
  expect(
    await db
      .select({ drawingId: shareRedirects.drawingId })
      .from(shareRedirects)
      .where(eq(shareRedirects.token, "m-token")),
  ).toEqual([{ drawingId: "m-1" }])
}, 30_000)
