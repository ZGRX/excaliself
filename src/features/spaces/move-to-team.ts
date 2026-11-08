// The move-to-Team engine: the one path that takes a row across spaces, and
// only Private → Team (ADR 0002). Kept out of server.ts, which imports the
// live db, so tests can drive it with a fake db.

import { and, eq, inArray, isNull } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings, folders, shareRedirects, shares } from "@/db/schema"
import { collectFolderSubtreeIds } from "@/features/folders/subtree"
import { lockFolderTree, type Tx } from "@/features/folders/tree-lock"
import { accessibleTo, inPrivateSpaceOf } from "./access"

export type MoveItem = { type: "drawing" | "folder"; id: string }

/**
 * Moves one of the caller's live Private drawings or folders into Team, under
 * `targetFolderId` (a live Team folder) or at Team root when null. A folder
 * takes its whole subtree, trashed rows included, so a later restore never
 * lands a Private row under a Team folder. Creators are kept. `members` Share
 * links go (every member can now open it anyway) and leave a redirect to the
 * drawing; `anyone` links stay, so guests keep their way in. Returns the moved drawing ids for the Handoff.
 */
export async function moveToTeam(
  db: Db,
  userId: string,
  item: MoveItem,
  targetFolderId: string | null,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    await lockFolderTree(tx, item.type === "folder" ? "change" : "place")
    if (targetFolderId) {
      const [target] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.id, targetFolderId),
            accessibleTo(folders, userId),
            eq(folders.space, "team"),
            isNull(folders.deletedAt),
          ),
        )
      if (!target) throw new Error("Folder not found")
    }

    let drawingIds: string[]
    if (item.type === "drawing") {
      const [drawing] = await tx
        .select({ id: drawings.id })
        .from(drawings)
        .where(
          and(
            eq(drawings.id, item.id),
            inPrivateSpaceOf(drawings, userId),
            isNull(drawings.deletedAt),
          ),
        )
      if (!drawing) throw new Error("Drawing not found")
      drawingIds = [drawing.id]

      await tx
        .update(drawings)
        .set({ space: "team", folderId: targetFolderId })
        .where(eq(drawings.id, drawing.id))
    } else {
      // Trashed rows too: they still sit in the subtree.
      const privateFolders = await tx
        .select({
          id: folders.id,
          parentId: folders.parentId,
          deletedAt: folders.deletedAt,
        })
        .from(folders)
        .where(inPrivateSpaceOf(folders, userId))
      const root = privateFolders.find((folder) => folder.id === item.id)
      if (!root || root.deletedAt) throw new Error("Folder not found")
      const folderIds = [...collectFolderSubtreeIds(privateFolders, item.id)]

      const subtreeDrawings = await tx
        .select({ id: drawings.id })
        .from(drawings)
        .where(
          and(
            inArray(drawings.folderId, folderIds),
            inPrivateSpaceOf(drawings, userId),
          ),
        )
      drawingIds = subtreeDrawings.map((drawing) => drawing.id)

      await tx
        .update(folders)
        .set({ space: "team" })
        .where(inArray(folders.id, folderIds))
      await tx
        .update(folders)
        .set({ parentId: targetFolderId })
        .where(eq(folders.id, item.id))
      if (drawingIds.length > 0)
        await tx
          .update(drawings)
          .set({ space: "team" })
          .where(inArray(drawings.id, drawingIds))
    }

    await dropMembersLinks(tx, drawingIds)
    return drawingIds
  })
}

/**
 * Moves several of the caller's live Private drawings to Team root, all or
 * nothing, with the same Share link rules as {@link moveToTeam}.
 */
export async function moveDrawingsToTeam(
  db: Db,
  userId: string,
  ids: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFolderTree(tx, "place")
    const moved = await tx
      .update(drawings)
      .set({ space: "team", folderId: null })
      .where(
        and(
          inArray(drawings.id, ids),
          inPrivateSpaceOf(drawings, userId),
          isNull(drawings.deletedAt),
        ),
      )
      .returning({ id: drawings.id })
    if (moved.length !== new Set(ids).size) throw new Error("Drawing not found")
    await dropMembersLinks(tx, ids)
  })
}

// `members` links go and leave a redirect; `anyone` links stay.
async function dropMembersLinks(tx: Tx, drawingIds: string[]) {
  if (drawingIds.length === 0) return
  const membersLinks = await tx
    .delete(shares)
    .where(
      and(
        inArray(shares.drawingId, drawingIds),
        eq(shares.audience, "members"),
      ),
    )
    .returning({ token: shares.token, drawingId: shares.drawingId })
  if (membersLinks.length > 0)
    await tx.insert(shareRedirects).values(membersLinks)
}
