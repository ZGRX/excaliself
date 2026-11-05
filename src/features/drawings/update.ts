// Renames a drawing or moves it to a folder, for the app and the MCP tools.
// Kept out of server.ts so the MCP endpoint can share it.

import { and, eq, isNull } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings } from "@/db/schema"
import { assertFolderTarget } from "@/features/folders/ownership"
import { lockFolderTree } from "@/features/folders/tree-lock"
import { accessibleTo } from "@/features/spaces/access"

/** `folderId: null` moves the drawing to the top of its space. */
export async function updateDrawingFields(
  db: Db,
  userId: string,
  id: string,
  fields: { name?: string; folderId?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (fields.folderId !== undefined) await lockFolderTree(tx, "place")
    const targetSpace = fields.folderId
      ? await assertFolderTarget(tx, userId, fields.folderId)
      : undefined
    // Access is enforced in the statement itself; zero rows means "not
    // found" so others can't tell a private drawing exists. Trashed
    // drawings are treated the same — no edits while in the trash — and so
    // is a move into a folder of the other space.
    const updated = await tx
      .update(drawings)
      .set({ ...fields, updatedAt: new Date() })
      .where(
        and(
          eq(drawings.id, id),
          accessibleTo(drawings, userId),
          isNull(drawings.deletedAt),
          targetSpace && eq(drawings.space, targetSpace),
        ),
      )
      .returning({ id: drawings.id })
    if (updated.length === 0) throw new Error("Drawing not found")
  })
}
