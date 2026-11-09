// Comment engines for the app's server functions and the MCP tools. A member
// can read a drawing's comments iff they can see it (the Space rule), and
// write them only while it is not trashed.

import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Db } from "@/db"
import {
  commentReads,
  comments,
  commentThreads,
  drawings,
  users,
} from "@/db/schema"
import { userDisplayName, userInitials } from "@/features/account/display-name"
import { accessibleTo } from "@/features/spaces/access"
import { MAX_COMMENT_LENGTH } from "./limits"

/** Where a pin sits; see `commentThreads` in the schema. */
export type Anchor =
  | { x: number; y: number; elementId?: undefined }
  | {
      x: number
      y: number
      elementId: string
      offsetX: number
      offsetY: number
    }

type Person = { name: string; initials: string; image: string | null }

/** Thrown for a missing body or one past {@link MAX_COMMENT_LENGTH}. */
export class InvalidComment extends Error {}

/** The body as stored: trimmed, and checked against the limit. */
export function commentBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw new InvalidComment("Write a comment first.")
  if ([...trimmed].length > MAX_COMMENT_LENGTH)
    throw new InvalidComment(
      `Comments can be up to ${MAX_COMMENT_LENGTH} characters.`,
    )
  return trimmed
}

const person = (
  user: { name: string; email: string; image: string | null } | null,
): Person | null =>
  user && {
    name: userDisplayName(user),
    initials: userInitials(user),
    image: user.image,
  }

const userFields = { name: users.name, email: users.email, image: users.image }

/** The drawing, if `userId` can see it. Writes also need it untrashed. */
async function findDrawing(
  db: Db,
  userId: string,
  drawingId: string,
  forWrite: boolean,
) {
  const [drawing] = await db
    .select({ id: drawings.id })
    .from(drawings)
    .where(
      and(
        eq(drawings.id, drawingId),
        accessibleTo(drawings, userId),
        forWrite ? isNull(drawings.deletedAt) : undefined,
      ),
    )
  if (!drawing) throw new Error("Drawing not found")
}

/** A thread on an untrashed drawing `userId` can see. */
async function findWritableThread(db: Db, userId: string, threadId: string) {
  const [thread] = await db
    .select({
      id: commentThreads.id,
      drawingId: commentThreads.drawingId,
      resolvedAt: commentThreads.resolvedAt,
    })
    .from(commentThreads)
    .innerJoin(drawings, eq(drawings.id, commentThreads.drawingId))
    .where(
      and(
        eq(commentThreads.id, threadId),
        accessibleTo(drawings, userId),
        isNull(drawings.deletedAt),
      ),
    )
  if (!thread) throw new Error("Comment not found")
  return thread
}

/**
 * Holds the thread row until the transaction ends, so a reply and a resolve,
 * or two deletes, can't interleave on one thread.
 */
const lockThread = (tx: Pick<Db, "select">, threadId: string) =>
  tx
    .select({ resolvedAt: commentThreads.resolvedAt })
    .from(commentThreads)
    .where(eq(commentThreads.id, threadId))
    .for("update")

/** A comment `userId` wrote, on an untrashed drawing they can see. */
async function findOwnComment(db: Db, userId: string, commentId: string) {
  const [comment] = await db
    .select({ id: comments.id, threadId: comments.threadId })
    .from(comments)
    .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
    .innerJoin(drawings, eq(drawings.id, commentThreads.drawingId))
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.authorId, userId),
        accessibleTo(drawings, userId),
        isNull(drawings.deletedAt),
      ),
    )
  if (!comment) throw new Error("Comment not found")
  return comment
}

/**
 * Every thread on a drawing, oldest first, each with its comments oldest
 * first. Trashed drawings too: their comments stay readable.
 */
export async function listThreads(db: Db, userId: string, drawingId: string) {
  await findDrawing(db, userId, drawingId, false)
  const resolver = alias(users, "resolver")
  const threads = await db
    .select({
      thread: commentThreads,
      resolver: {
        name: resolver.name,
        email: resolver.email,
        image: resolver.image,
      },
      readAt: commentReads.readAt,
    })
    .from(commentThreads)
    .leftJoin(resolver, eq(resolver.id, commentThreads.resolvedBy))
    .leftJoin(
      commentReads,
      and(
        eq(commentReads.threadId, commentThreads.id),
        eq(commentReads.userId, userId),
      ),
    )
    .where(eq(commentThreads.drawingId, drawingId))
    .orderBy(asc(commentThreads.createdAt))
  if (threads.length === 0) return []

  const rows = await db
    .select({ comment: comments, author: userFields })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(
      inArray(
        comments.threadId,
        threads.map(({ thread }) => thread.id),
      ),
    )
    .orderBy(asc(comments.createdAt))

  return threads.map(({ thread, resolver, readAt }) => {
    const own = rows.filter(({ comment }) => comment.threadId === thread.id)
    return {
      id: thread.id,
      x: thread.x,
      y: thread.y,
      elementId: thread.elementId,
      offsetX: thread.offsetX,
      offsetY: thread.offsetY,
      createdAt: thread.createdAt,
      lastActivityAt: thread.lastActivityAt,
      resolvedAt: thread.resolvedAt,
      resolvedBy: thread.resolvedAt ? person(resolver) : null,
      // New to the caller: written since they last opened it, by someone
      // else or by their AI client.
      unread: own.some(
        ({ comment }) =>
          (comment.authorId !== userId || comment.via !== null) &&
          (!readAt || comment.createdAt > readAt),
      ),
      comments: own.map(({ comment, author }) => ({
        id: comment.id,
        author: person(author),
        mine: comment.authorId === userId,
        via: comment.via,
        body: comment.body,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
      })),
    }
  })
}

export type CommentThread = Awaited<ReturnType<typeof listThreads>>[number]

/** Starts a thread with its first comment. Returns the thread id. */
export async function createThread(
  db: Db,
  userId: string,
  input: { drawingId: string; anchor: Anchor; body: string; via?: string },
): Promise<string> {
  const body = commentBody(input.body)
  await findDrawing(db, userId, input.drawingId, true)
  const { anchor } = input
  const id = randomUUID()
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(commentThreads).values({
      id,
      drawingId: input.drawingId,
      createdBy: userId,
      x: anchor.x,
      y: anchor.y,
      ...(anchor.elementId !== undefined && {
        elementId: anchor.elementId,
        offsetX: anchor.offsetX,
        offsetY: anchor.offsetY,
      }),
      createdAt: now,
      lastActivityAt: now,
    })
    await tx.insert(comments).values({
      id: randomUUID(),
      threadId: id,
      authorId: userId,
      via: input.via ?? null,
      body,
      createdAt: now,
    })
  })
  return id
}

/** Adds a comment to an open thread. */
export async function addReply(
  db: Db,
  userId: string,
  input: { threadId: string; body: string; via?: string },
): Promise<void> {
  const body = commentBody(input.body)
  const thread = await findWritableThread(db, userId, input.threadId)
  const now = new Date()
  await db.transaction(async (tx) => {
    const [locked] = await lockThread(tx, thread.id)
    if (!locked) throw new Error("Comment not found")
    if (locked.resolvedAt) throw new Error("Reopen this thread to reply.")
    await tx.insert(comments).values({
      id: randomUUID(),
      threadId: thread.id,
      authorId: userId,
      via: input.via ?? null,
      body,
      createdAt: now,
    })
    await tx
      .update(commentThreads)
      .set({ lastActivityAt: now })
      .where(eq(commentThreads.id, thread.id))
  })
}

/** Resolves or reopens a thread. Any member who can see the drawing can. */
export async function setResolved(
  db: Db,
  userId: string,
  threadId: string,
  resolved: boolean,
): Promise<void> {
  await findWritableThread(db, userId, threadId)
  await db
    .update(commentThreads)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: userId }
        : { resolvedAt: null, resolvedBy: null },
    )
    // Resolving again keeps who resolved it first, and when.
    .where(
      and(
        eq(commentThreads.id, threadId),
        resolved ? isNull(commentThreads.resolvedAt) : undefined,
      ),
    )
}

/** Changes the text of the caller's own comment. */
export async function editComment(
  db: Db,
  userId: string,
  commentId: string,
  body: string,
): Promise<void> {
  const text = commentBody(body)
  await findOwnComment(db, userId, commentId)
  await db
    .update(comments)
    .set({ body: text, editedAt: new Date() })
    .where(eq(comments.id, commentId))
}

/** Deletes the caller's own comment, and its thread when it was the last. */
export async function deleteComment(
  db: Db,
  userId: string,
  commentId: string,
): Promise<void> {
  const { threadId } = await findOwnComment(db, userId, commentId)
  await db.transaction(async (tx) => {
    // Two last comments deleted at once must not leave an empty thread.
    await lockThread(tx, threadId)
    await tx.delete(comments).where(eq(comments.id, commentId))
    await tx
      .delete(commentThreads)
      .where(
        and(
          eq(commentThreads.id, threadId),
          sql`not exists (select 1 from ${comments} where ${comments.threadId} = ${threadId})`,
        ),
      )
  })
}

/** Records that the caller has read a thread up to now. */
export async function markRead(
  db: Db,
  userId: string,
  threadId: string,
): Promise<void> {
  const [thread] = await db
    .select({ id: commentThreads.id })
    .from(commentThreads)
    .innerJoin(drawings, eq(drawings.id, commentThreads.drawingId))
    .where(and(eq(commentThreads.id, threadId), accessibleTo(drawings, userId)))
  if (!thread) throw new Error("Comment not found")
  const readAt = new Date()
  await db
    .insert(commentReads)
    .values({ userId, threadId, readAt })
    .onConflictDoUpdate({
      target: [commentReads.userId, commentReads.threadId],
      set: { readAt },
    })
}

/** Open threads on a drawing the caller already checked. */
export async function countOpenThreads(
  db: Db,
  drawingId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentThreads)
    .where(
      and(
        eq(commentThreads.drawingId, drawingId),
        isNull(commentThreads.resolvedAt),
      ),
    )
  return row?.count ?? 0
}
