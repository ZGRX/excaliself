"use server"

// The app's comment server functions. Every write tells open tabs to refetch.

import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { db } from "@/db"
import { listUpdates } from "@/features/list-updates/hub"
import { COMMENTS_CHANGED } from "@/features/list-updates/protocol"
import { authMiddleware } from "@/middleware/auth"
import {
  addReply,
  createThread,
  deleteComment,
  editComment,
  listThreads,
  markRead,
  setResolved,
} from "./store"

const coordinate = z.number().finite()
const fraction = z.number().finite().min(0).max(1)
const anchor = z.union([
  z.object({
    x: coordinate,
    y: coordinate,
    elementId: z.string().min(1).max(64),
    offsetX: fraction,
    offsetY: fraction,
  }),
  z.object({ x: coordinate, y: coordinate }),
])
// The store trims and checks the limit; this only bounds the payload.
const body = z.string().max(20_000)

export const getCommentThreads = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(({ data: drawingId, context }) =>
    listThreads(db, context.session.user.id, drawingId),
  )

export const startCommentThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ drawingId: z.string(), anchor, body }))
  .handler(async ({ data, context }) => {
    const id = await createThread(db, context.session.user.id, data)
    listUpdates.notify(COMMENTS_CHANGED)
    return id
  })

export const replyToCommentThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ threadId: z.string(), body }))
  .handler(async ({ data, context }) => {
    await addReply(db, context.session.user.id, data)
    listUpdates.notify(COMMENTS_CHANGED)
  })

export const resolveCommentThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ threadId: z.string(), resolved: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setResolved(db, context.session.user.id, data.threadId, data.resolved)
    listUpdates.notify(COMMENTS_CHANGED)
  })

export const editOwnComment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ commentId: z.string(), body }))
  .handler(async ({ data, context }) => {
    await editComment(db, context.session.user.id, data.commentId, data.body)
    listUpdates.notify(COMMENTS_CHANGED)
  })

export const deleteOwnComment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(async ({ data: commentId, context }) => {
    await deleteComment(db, context.session.user.id, commentId)
    listUpdates.notify(COMMENTS_CHANGED)
  })

/** Only the caller's own tabs care, and the frame carries no data anyway. */
export const markCommentThreadRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(async ({ data: threadId, context }) => {
    await markRead(db, context.session.user.id, threadId)
    listUpdates.notify(COMMENTS_CHANGED)
  })
