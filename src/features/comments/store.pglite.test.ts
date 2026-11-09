// @vitest-environment node
import { eq } from "drizzle-orm"
import { beforeAll, expect, test } from "vitest"
import type { Db } from "@/db/index"
import { createPreviewDb } from "@/db/preview"
import { drawings, users } from "@/db/schema"
import { hardDeleteUser } from "@/features/admin/delete-user"
import { MAX_COMMENT_LENGTH } from "./limits"
import {
  addReply,
  createThread,
  deleteComment,
  editComment,
  listThreads,
  markRead,
  setResolved,
} from "./store"

const ada = { id: "ada", email: "ada@example.com", name: "Ada" }
const bo = { id: "bo", email: "bo@example.com", name: "Bo" }
const point = { x: 10, y: 20 }

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
  await db.insert(users).values([ada, bo])
  await db.insert(drawings).values([
    { id: "team", name: "Team", space: "team", createdBy: ada.id },
    { id: "adas", name: "Ada's", space: "private", createdBy: ada.id },
    { id: "trashed", name: "Trashed", space: "team", createdBy: ada.id },
  ])
}, 30_000)

const start = (userId: string, drawingId: string, body = "Look here") =>
  createThread(db, userId, { drawingId, anchor: point, body })

// Read state compares millisecond timestamps.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 2))

const threadOf = async (userId: string, drawingId: string, id: string) =>
  (await listThreads(db, userId, drawingId)).find((t) => t.id === id)

test("only members who can see the drawing read and write its comments", async () => {
  const onPrivate = await start(ada.id, "adas")
  const onTeam = await start(ada.id, "team")
  await addReply(db, bo.id, { threadId: onTeam, body: "Agreed" })

  expect(
    (await threadOf(bo.id, "team", onTeam))?.comments.map((c) => c.body),
  ).toEqual(["Look here", "Agreed"])
  await expect(listThreads(db, bo.id, "adas")).rejects.toThrow(
    "Drawing not found",
  )
  await expect(start(bo.id, "adas")).rejects.toThrow("Drawing not found")
  await expect(
    addReply(db, bo.id, { threadId: onPrivate, body: "Hi" }),
  ).rejects.toThrow("Comment not found")
  await expect(setResolved(db, bo.id, onPrivate, true)).rejects.toThrow(
    "Comment not found",
  )
})

test("a trashed drawing's comments stay readable but take no writes", async () => {
  const thread = await start(ada.id, "trashed")
  await db
    .update(drawings)
    .set({ deletedAt: new Date(), trashRootId: "trashed" })
    .where(eq(drawings.id, "trashed"))

  expect(await threadOf(ada.id, "trashed", thread)).toBeDefined()
  await expect(start(ada.id, "trashed")).rejects.toThrow("Drawing not found")
  await expect(
    addReply(db, ada.id, { threadId: thread, body: "More" }),
  ).rejects.toThrow("Comment not found")
})

test("a resolved thread takes no replies until it is reopened", async () => {
  const thread = await start(ada.id, "team")
  await setResolved(db, bo.id, thread, true)
  await setResolved(db, ada.id, thread, true)

  expect((await threadOf(ada.id, "team", thread))?.resolvedBy?.name).toBe("Bo")
  await expect(
    addReply(db, ada.id, { threadId: thread, body: "Wait" }),
  ).rejects.toThrow("Reopen this thread to reply.")

  await setResolved(db, ada.id, thread, false)
  await addReply(db, ada.id, { threadId: thread, body: "Wait" })
  expect((await threadOf(ada.id, "team", thread))?.resolvedAt).toBeNull()
})

test("a thread is unread for a member until they open it, never for their own comments", async () => {
  const thread = await start(ada.id, "team")
  expect((await threadOf(ada.id, "team", thread))?.unread).toBe(false)
  expect((await threadOf(bo.id, "team", thread))?.unread).toBe(true)

  await nextMillisecond()
  await markRead(db, bo.id, thread)
  expect((await threadOf(bo.id, "team", thread))?.unread).toBe(false)

  // Written by Ada's AI client: new to Ada too.
  await nextMillisecond()
  await addReply(db, ada.id, { threadId: thread, body: "Done", via: "Claude" })
  expect((await threadOf(ada.id, "team", thread))?.unread).toBe(true)
  expect((await threadOf(bo.id, "team", thread))?.unread).toBe(true)
})

test("only the author edits or deletes a comment; the last one takes its thread", async () => {
  const thread = await start(ada.id, "team")
  await addReply(db, bo.id, { threadId: thread, body: "Reply" })
  const [first, reply] =
    (await threadOf(ada.id, "team", thread))?.comments ?? []

  await expect(editComment(db, bo.id, first.id, "Mine now")).rejects.toThrow(
    "Comment not found",
  )
  await expect(deleteComment(db, bo.id, first.id)).rejects.toThrow(
    "Comment not found",
  )
  await editComment(db, ada.id, first.id, "Look there")
  expect((await threadOf(ada.id, "team", thread))?.comments[0]).toMatchObject({
    body: "Look there",
    editedAt: expect.any(Date),
  })

  await deleteComment(db, ada.id, first.id)
  expect(
    (await threadOf(ada.id, "team", thread))?.comments.map((c) => c.body),
  ).toEqual(["Reply"])
  await deleteComment(db, bo.id, reply.id)
  expect(await threadOf(ada.id, "team", thread)).toBeUndefined()
})

test("bodies are trimmed and limited", async () => {
  await expect(start(ada.id, "team", "   ")).rejects.toThrow(
    "Write a comment first.",
  )
  await expect(
    start(ada.id, "team", "a".repeat(MAX_COMMENT_LENGTH + 1)),
  ).rejects.toThrow(`up to ${MAX_COMMENT_LENGTH} characters`)
  // Code points, not UTF-16 units.
  const thread = await start(
    ada.id,
    "team",
    ` ${"🙂".repeat(MAX_COMMENT_LENGTH)} `,
  )
  expect((await threadOf(ada.id, "team", thread))?.comments[0].body).toBe(
    "🙂".repeat(MAX_COMMENT_LENGTH),
  )
})

test("a deleted member's Team comments stay, with no author", async () => {
  const carl = { id: "carl", email: "carl@example.com", name: "Carl" }
  await db.insert(users).values(carl)
  const thread = await start(carl.id, "team")
  await hardDeleteUser(db, carl.id)

  expect(
    (await threadOf(ada.id, "team", thread))?.comments[0].author,
  ).toBeNull()
})
