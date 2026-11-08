"use server"

// The gallery's bulk actions: one request and one list update per action,
// all or nothing. See bulk.ts for the rules.

import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { db } from "@/db"
import { userDisplayName } from "@/features/account/display-name"
import { endTrashedRooms, rooms } from "@/features/collab/room-registry"
import { moveRoomToTeam } from "@/features/collab/room-session"
import { moveDrawingsToTeam as moveDrawingsToTeamEngine } from "@/features/spaces/move-to-team"
import { restoreDrawingUnits } from "@/features/trash/restore"
import { authMiddleware } from "@/middleware/auth"
import { listsChangedMiddleware } from "@/middleware/lists-changed"
import {
  moveDrawingsToFolder as moveDrawingsToFolderEngine,
  starDrawings,
  trashDrawings as trashDrawingsEngine,
} from "./bulk"

const ids = z.array(z.string()).min(1)

export const setDrawingsStarred = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(z.object({ ids, starred: z.boolean() }))
  .handler(({ data, context }) =>
    starDrawings(db, context.session.user.id, data.ids, data.starred),
  )

export const moveDrawingsToFolder = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(z.object({ ids, folderId: z.string().nullable() }))
  .handler(({ data, context }) =>
    moveDrawingsToFolderEngine(
      db,
      context.session.user.id,
      data.ids,
      data.folderId,
    ),
  )

export const trashDrawings = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(ids)
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id
    await trashDrawingsEngine(db, userId, data)
    await endTrashedRooms(data, {
      userId,
      name: userDisplayName(context.session.user),
    })
  })

/** Undo for trashDrawings. Each drawing lands as a single restore does. */
export const restoreDrawings = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(ids)
  .handler(({ data, context }) =>
    restoreDrawingUnits(db, context.session.user.id, data),
  )

/** Private → Team root. The grid has no open canvas, so nothing to flush. */
export const moveDrawingsToTeam = createServerFn({ method: "POST" })
  .middleware([authMiddleware, listsChangedMiddleware])
  .validator(ids)
  .handler(async ({ data, context }) => {
    await moveDrawingsToTeamEngine(db, context.session.user.id, data)
    await Promise.all(data.map((id) => moveRoomToTeam(rooms, id)))
  })
