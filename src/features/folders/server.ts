"use server"

import { createServerFn } from "@tanstack/react-start"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { folders, spaces } from "@/db/schema"
import { userDisplayName } from "@/features/account/display-name"
import { endTrashedRooms } from "@/features/collab/room-registry"
import { MAX_NAME_LENGTH } from "@/features/drawings/list-columns"
import { accessibleTo } from "@/features/spaces/access"
import { restoreFolderUnit } from "@/features/trash/restore"
import { trashFolderUnit } from "@/features/trash/trash"
import { authMiddleware } from "@/middleware/auth"
import { listsChangedMiddleware } from "@/middleware/lists-changed"
import { insertFolder } from "./create"
import { listFolders } from "./list"
import { assertFolderTarget } from "./ownership"
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
  .handler(({ data, context }) =>
    insertFolder(db, context.session.user.id, {
      name: data.name,
      parentId: data.parentId ?? null,
      space: data.space,
    }),
  )

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

/** Trashes a folder and its subtree as one unit; see trashFolderUnit. */
export const trashFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(z.string())
  .handler(async ({ data: id, context }) => {
    const userId = context.session.user.id
    const swept = await trashFolderUnit(db, userId, id)
    // Swept drawings end their live rooms too, like a direct trash.
    await endTrashedRooms(swept, {
      userId,
      name: userDisplayName(context.session.user),
    })
  })

/** Restores a folder trash unit; see restoreFolderUnit for the landing rules. */
export const restoreFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(z.string())
  .handler(async ({ data: id, context }) =>
    restoreFolderUnit(db, context.session.user.id, id),
  )
