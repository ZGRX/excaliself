"use server"

import { randomUUID } from "node:crypto"
import { createServerFn } from "@tanstack/react-start"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { drawings, folders, spaces } from "@/db/schema"
import { userDisplayName } from "@/features/account/display-name"
import { endTrashedRooms } from "@/features/collab/room-registry"
import {
  folderColumns,
  MAX_NAME_LENGTH,
} from "@/features/drawings/list-columns"
import { accessibleTo } from "@/features/spaces/access"
import { restoreFolderUnit } from "@/features/trash/restore"
import { authMiddleware } from "@/middleware/auth"
import { listsChangedMiddleware } from "@/middleware/lists-changed"
import { listFolders } from "./list"
import { assertFolderTarget } from "./ownership"
import { collectFolderSubtreeIds } from "./subtree"
import { lockFolderTree } from "./tree-lock"

export const getFolders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return listFolders(db, context.session.user.id)
  })

export const createFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(MAX_NAME_LENGTH),
      parentId: z.string().nullable().optional(),
      // Ignored inside a parent folder: the folder takes the parent's space.
      space: z.enum(spaces).default("private"),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id
    const id = randomUUID()
    const now = new Date()
    const parentId = data.parentId ?? null

    return db.transaction(async (tx) => {
      await lockFolderTree(tx, "place")
      const space = parentId
        ? await assertFolderTarget(tx, userId, parentId)
        : data.space
      const [folder] = await tx
        .insert(folders)
        .values({
          id,
          name: data.name,
          space,
          createdBy: userId,
          parentId,
          createdAt: now,
          updatedAt: now,
        })
        .returning(folderColumns)
      return folder
    })
  })

export const updateFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
      parentId: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id

    const updateFields: { name?: string; parentId?: string | null } = {}
    if (data.name !== undefined) updateFields.name = data.name
    if (data.parentId !== undefined) updateFields.parentId = data.parentId

    await db.transaction(async (tx) => {
      if (data.parentId !== undefined) await lockFolderTree(tx, "change")
      const targetSpace = data.parentId
        ? await assertFolderTarget(tx, userId, data.parentId, data.id)
        : undefined

      // Access is enforced in the statement itself; zero rows means "not
      // found" so others can't tell a private folder exists. Trashed folders
      // are treated the same — no edits while in the trash — and so is a move
      // into a folder of the other space.
      const updated = await tx
        .update(folders)
        .set({ ...updateFields, updatedAt: new Date() })
        .where(
          and(
            eq(folders.id, data.id),
            accessibleTo(folders, userId),
            isNull(folders.deletedAt),
            targetSpace && eq(folders.space, targetSpace),
          ),
        )
        .returning({ id: folders.id })
      if (updated.length === 0) throw new Error("Folder not found")
    })
  })

/**
 * Soft-deletes a folder and its whole subtree (descendant folders + their
 * drawings) as one trash unit: every swept row gets the same trashRootId so
 * the unit can be restored intact. Rows that were already trashed keep their
 * own unit and are left untouched — restoring this folder must not resurrect
 * things trashed separately before it.
 */
export const trashFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(z.string())
  .handler(async ({ data: id, context }) => {
    const userId = context.session.user.id
    const now = new Date()

    const swept = await db.transaction(async (tx) => {
      await lockFolderTree(tx, "change")
      const liveFolders = await tx
        .select({ id: folders.id, parentId: folders.parentId })
        .from(folders)
        .where(and(accessibleTo(folders, userId), isNull(folders.deletedAt)))
      if (!liveFolders.some((folder) => folder.id === id))
        throw new Error("Folder not found")

      const subtreeIds = [...collectFolderSubtreeIds(liveFolders, id)]

      await tx
        .update(folders)
        .set({ deletedAt: now, trashRootId: id, deletedBy: userId })
        .where(
          and(
            inArray(folders.id, subtreeIds),
            accessibleTo(folders, userId),
            isNull(folders.deletedAt),
          ),
        )
      // Leaves updatedAt alone (see trashDrawing) so restore is in place.
      return tx
        .update(drawings)
        .set({ deletedAt: now, trashRootId: id, deletedBy: userId })
        .where(
          and(
            inArray(drawings.folderId, subtreeIds),
            accessibleTo(drawings, userId),
            isNull(drawings.deletedAt),
          ),
        )
        .returning({ id: drawings.id })
    })

    // Swept drawings end their live rooms too, like a direct trash.
    await endTrashedRooms(
      swept.map((drawing) => drawing.id),
      { userId, name: userDisplayName(context.session.user) },
    )
  })

/** Restores a folder trash unit; see restoreFolderUnit for the landing rules. */
export const restoreFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(z.string())
  .handler(async ({ data: id, context }) =>
    restoreFolderUnit(db, context.session.user.id, id),
  )
