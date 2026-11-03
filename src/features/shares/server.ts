"use server"

import { createServerFn } from "@tanstack/react-start"
import {
  getRequestHeaders,
  getRequestIP,
  setResponseStatus,
} from "@tanstack/react-start/server"
import { z } from "zod"
import { db } from "@/db"
import { rooms } from "@/features/collab/room-registry"
import { endLinkRoom, evictNonMembers } from "@/features/collab/room-session"
import { auth } from "@/lib/auth"
import { authMiddleware } from "@/middleware/auth"
import { admitsGuests } from "./access"
import {
  createShareLink,
  getShareLink,
  regenerateShareLink,
  resolveShareVisit,
  type ShareResolution,
  setShareLinkAudience,
  stopSharingDrawing,
} from "./store"
import { spendFailedTokenLookup } from "./token-rate-limit"

const audienceSchema = z.enum(["members", "anyone"])

export const getDrawingShare = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(async ({ data: drawingId, context }) =>
    getShareLink(db, context.session.user.id, drawingId),
  )

export const createShare = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ drawingId: z.string(), audience: audienceSchema }))
  .handler(async ({ data, context }) =>
    createShareLink(db, context.session.user.id, data.drawingId, data.audience),
  )

// Write the row before touching the room, so a socket joining in between
// can't keep its seat.

export const stopSharing = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(async ({ data: drawingId, context }) => {
    await stopSharingDrawing(db, context.session.user.id, drawingId)
    await endLinkRoom(rooms, drawingId)
  })

export const regenerateShare = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(async ({ data: drawingId, context }) => {
    const share = await regenerateShareLink(
      db,
      context.session.user.id,
      drawingId,
    )
    await endLinkRoom(rooms, drawingId)
    return share
  })

export const setShareAudience = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ drawingId: z.string(), audience: audienceSchema }))
  .handler(async ({ data, context }) => {
    const share = await setShareLinkAudience(
      db,
      context.session.user.id,
      data.drawingId,
      data.audience,
    )
    if (!admitsGuests(share.audience))
      await evictNonMembers(rooms, data.drawingId)
    return share
  })

export type ShareVisit = ShareResolution | { status: "throttled" }

/** Public (pre-auth) share token lookup for the /share/$token loader. */
export const resolveShareToken = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data: token }): Promise<ShareVisit> => {
    const headers = getRequestHeaders()
    const visit = await resolveShareVisit(
      db,
      token,
      async () => (await auth.api.getSession({ headers })) !== null,
    )
    if (
      visit.status === "dead" &&
      !spendFailedTokenLookup({ headers, socketIp: getRequestIP() })
    ) {
      setResponseStatus(429)
      return { status: "throttled" }
    }
    return visit
  })
