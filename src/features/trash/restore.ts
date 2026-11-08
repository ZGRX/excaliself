// Restore engines behind the Restore actions (spec §5.11). Kept out of the
// server function modules, which import the live db, so tests can drive them
// with a fake db, like destroy.ts.

import { and, eq, isNotNull } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings, folders, type Space } from "@/db/schema"
import { findNearestLiveAncestorId } from "@/features/folders/subtree"
import { lockFolderTree, type Tx } from "@/features/folders/tree-lock"
import { accessibleTo } from "@/features/spaces/access"

// Clears every trash mark a row gets when it is trashed as or within a unit.
const UNTRASHED = { deletedAt: null, trashRootId: null, deletedBy: null }

/**
 * Where a restored unit lands, given the folder it was in: that folder when
 * live, else its nearest live ancestor, else root. Only folders of the unit's
 * own space count, so a Team unit never lands under a Private folder.
 */
async function findLanding(
  tx: Tx,
  userId: string,
  space: Space,
  originalId: string,
) {
  const visibleFolders = await tx
    .select({
      id: folders.id,
      parentId: folders.parentId,
      deletedAt: folders.deletedAt,
      space: folders.space,
    })
    .from(folders)
    .where(accessibleTo(folders, userId))
  const candidates = visibleFolders.filter((folder) => folder.space === space)
  return {
    landingId: findNearestLiveAncestorId(candidates, originalId),
    originalGone: !candidates.some((folder) => folder.id === originalId),
  }
}

/**
 * Restores a trashed drawing: back to its original folder when that folder is
 * live; to the nearest live ancestor when the folder is trashed (never
 * resurrecting a trashed parent chain); to its space's root when the folder
 * no longer exists — `originalFolderGone` lets the caller show the toast.
 */
export async function restoreDrawingUnit(
  db: Db,
  userId: string,
  id: string,
): Promise<{ originalFolderGone: boolean }> {
  return db.transaction(async (tx) => {
    await lockFolderTree(tx, "place")
    return restoreDrawingInTx(tx, userId, id)
  })
}

/** Restores trashed drawings together, all or nothing; see restoreDrawingUnit. */
export async function restoreDrawingUnits(
  db: Db,
  userId: string,
  ids: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockFolderTree(tx, "place")
    for (const id of ids) await restoreDrawingInTx(tx, userId, id)
  })
}

// restoreDrawingUnit's body. Call it under the "place" lock.
async function restoreDrawingInTx(
  tx: Tx,
  userId: string,
  id: string,
): Promise<{ originalFolderGone: boolean }> {
  const [restored] = await tx
    .update(drawings)
    .set(UNTRASHED)
    .where(
      and(
        eq(drawings.id, id),
        accessibleTo(drawings, userId),
        isNotNull(drawings.deletedAt),
      ),
    )
    .returning({
      id: drawings.id,
      folderId: drawings.folderId,
      space: drawings.space,
    })
  if (!restored) throw new Error("Drawing not found")
  if (!restored.folderId) return { originalFolderGone: false }

  const { landingId, originalGone } = await findLanding(
    tx,
    userId,
    restored.space,
    restored.folderId,
  )
  if (landingId !== restored.folderId) {
    await tx
      .update(drawings)
      .set({ folderId: landingId })
      .where(eq(drawings.id, id))
  }
  return { originalFolderGone: originalGone }
}

/**
 * Restores a folder trash unit: everything trashFolder(id) swept, with the
 * subtree intact. The root folder lands like a drawing does (see
 * restoreDrawingUnit), flagged as `originalParentGone` for the toast.
 */
export async function restoreFolderUnit(
  db: Db,
  userId: string,
  id: string,
): Promise<{ originalParentGone: boolean }> {
  return db.transaction(async (tx) => {
    await lockFolderTree(tx, "change")
    const restored = await tx
      .update(folders)
      .set(UNTRASHED)
      .where(and(eq(folders.trashRootId, id), accessibleTo(folders, userId)))
      .returning({
        id: folders.id,
        parentId: folders.parentId,
        space: folders.space,
      })
    const root = restored.find((folder) => folder.id === id)
    if (!root) throw new Error("Folder not found")

    await tx
      .update(drawings)
      .set(UNTRASHED)
      .where(and(eq(drawings.trashRootId, id), accessibleTo(drawings, userId)))

    if (!root.parentId) return { originalParentGone: false }

    const { landingId, originalGone } = await findLanding(
      tx,
      userId,
      root.space,
      root.parentId,
    )
    if (landingId !== root.parentId) {
      await tx
        .update(folders)
        .set({ parentId: landingId })
        .where(eq(folders.id, id))
    }
    return { originalParentGone: originalGone }
  })
}
