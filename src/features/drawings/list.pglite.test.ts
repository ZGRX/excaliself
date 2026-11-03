// @vitest-environment node
import { beforeAll, expect, test } from "vitest"
import { demoAdmin } from "@/db/demo-content"
import type { Db } from "@/db/index"
import { createPreviewDb } from "@/db/preview"
import { drawings, folders, users } from "@/db/schema"
import { listFolders } from "@/features/folders/list"
import { listDrawings } from "./list"
import { LIST_SEARCH_TEXT_LENGTH, MAX_NAME_LENGTH } from "./list-columns"

const member = { id: "member-b", email: "b@example.com", name: "B" }

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
  await db.insert(users).values(member)
}, 30_000)

// A Team drawing reaches every member's list, so its size is on everyone.
test("another member's huge Team drawing reaches the list cut short", async () => {
  await db.insert(drawings).values({
    id: "huge",
    name: "n".repeat(1_000_000),
    searchText: `needle ${"a".repeat(1_000_000)}`,
    space: "team",
    createdBy: demoAdmin.id,
  })

  const huge = (await listDrawings(db, member.id)).find((d) => d.id === "huge")

  expect(huge?.searchText).toBe(
    `needle ${"a".repeat(LIST_SEARCH_TEXT_LENGTH - 7)}`,
  )
  expect(huge?.name).toBe("n".repeat(MAX_NAME_LENGTH))
}, 30_000)

test("another member's Team folder name reaches the list cut short", async () => {
  await db.insert(folders).values({
    id: "long",
    name: "f".repeat(1_000_000),
    space: "team",
    createdBy: demoAdmin.id,
  })

  const long = (await listFolders(db, member.id)).find((f) => f.id === "long")

  expect(long?.name).toBe("f".repeat(MAX_NAME_LENGTH))
}, 30_000)
