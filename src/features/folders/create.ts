// A new folder, from the sidebar or an MCP client. Kept out of server.ts so
// the MCP endpoint can share it.

import { randomUUID } from "node:crypto"
import type { Db } from "@/db"
import { folders, type Space } from "@/db/schema"
import { folderColumns } from "@/features/drawings/list-columns"
import { assertFolderTarget } from "./ownership"
import { lockFolderTree } from "./tree-lock"

/** Inside a parent the folder takes the parent's space, and `space` is ignored. */
export async function insertFolder(
  db: Db,
  userId: string,
  input: { name: string; parentId: string | null; space: Space },
) {
  const now = new Date()
  return db.transaction(async (tx) => {
    await lockFolderTree(tx, "place")
    const space = input.parentId
      ? await assertFolderTarget(tx, userId, input.parentId)
      : input.space
    const [folder] = await tx
      .insert(folders)
      .values({
        id: randomUUID(),
        name: input.name,
        space,
        createdBy: userId,
        parentId: input.parentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(folderColumns)
    return folder
  })
}
