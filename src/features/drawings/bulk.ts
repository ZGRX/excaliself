// Engines behind the gallery's bulk actions. Each one is all or nothing: if
// any drawing is not one the caller can act on, nothing changes. Kept out of
// the server function modules, which import the live db, so tests can drive
// them with PGlite.

import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings, stars } from "@/db/schema"
import { assertFolderTarget } from "@/features/folders/ownership"
import { lockFolderTree } from "@/features/folders/tree-lock"
import { accessibleTo } from "@/features/spaces/access"

// Live drawings the caller can act on, among `ids`.
const actionable = (userId: string, ids: string[]) =>
  and(
    inArray(drawings.id, ids),
    accessibleTo(drawings, userId),
    isNull(drawings.deletedAt),
  )

function assertAll(found: unknown[], ids: string[]) {
  if (found.length !== new Set(ids).size) throw new Error("Drawing not found")
}

/** Stars or unstars drawings for the caller. Like one star, not an edit. */
export async function starDrawings(
  db: Db,
  userId: string,
  ids: string[],
  starred: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await tx
      .select({ id: drawings.id })
      .from(drawings)
      .where(actionable(userId, ids))
    assertAll(found, ids)
    if (starred) {
      await tx
        .insert(stars)
        .values(ids.map((drawingId) => ({ userId, drawingId })))
        .onConflictDoNothing()
    } else {
      await tx
        .delete(stars)
        .where(and(eq(stars.userId, userId), inArray(stars.drawingId, ids)))
    }
  })
}

/**
 * Moves drawings into a folder, or to the top of their space when null. A
 * folder takes only drawings of its own space, as a single move does.
 */
export async function moveDrawingsToFolder(
  db: Db,
  userId: string,
  ids: string[],
  folderId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFolderTree(tx, "place")
    const targetSpace = folderId
      ? await assertFolderTarget(tx, userId, folderId)
      : undefined
    const moved = await tx
      .update(drawings)
      .set({ folderId, updatedAt: new Date() })
      .where(
        and(
          actionable(userId, ids),
          targetSpace && eq(drawings.space, targetSpace),
        ),
      )
      .returning({ id: drawings.id })
    assertAll(moved, ids)
  })
}

/**
 * Moves drawings to the trash, each as its own unit, so each one restores
 * on its own. The caller ends their Rooms.
 */
export async function trashDrawings(
  db: Db,
  userId: string,
  ids: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    // Leaves updatedAt alone, as trashDrawingUnit does.
    const trashed = await tx
      .update(drawings)
      .set({
        deletedAt: new Date(),
        trashRootId: sql`${drawings.id}`,
        deletedBy: userId,
      })
      .where(actionable(userId, ids))
      .returning({ id: drawings.id })
    assertAll(trashed, ids)
  })
}
