"use server"

import type { LibraryItem } from "@excalidraw/excalidraw/types"
import { createServerFn } from "@tanstack/react-start"
import { desc, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { type Db, db } from "@/db"
import { libraryItems } from "@/db/schema"
import { listUpdates } from "@/features/list-updates/hub"
import { LIBRARY_CHANGED } from "@/features/list-updates/protocol"
import { createRateLimiter } from "@/lib/rate-limit"
import { authMiddleware } from "@/middleware/auth"
import {
  LIBRARY_CHANGES_PER_MINUTE,
  MAX_LIBRARY_BYTES,
  MAX_LIBRARY_ITEM_BYTES,
} from "./limits"

// Enough of Excalidraw's LibraryItem to render; the rest is stored as is.
const libraryItemShape = z.looseObject({
  id: z.string().min(1),
  status: z.enum(["published", "unpublished"]),
  elements: z.array(z.looseObject({ id: z.string(), type: z.string() })).min(1),
  created: z.number(),
  name: z.string().optional(),
})
const libraryItem = z.custom<LibraryItem>(
  (value) => libraryItemShape.safeParse(value).success,
)

// The library as one JSON array, newest first, built from Postgres' own text.
// Sent raw: Start's serializer fails past 32 MiB of its output, which a
// library well under that can reach, and then no member could load it.
const readLibraryJson = async (from: Pick<Db, "select">) => {
  const rows = await from
    .select({ json: sql<string>`${libraryItems.item}::text` })
    .from(libraryItems)
    .orderBy(desc(libraryItems.seq))
  return `[${rows.map((row) => row.json).join(",")}]`
}

const libraryResponse = (json: string) =>
  new Response(json, { headers: { "content-type": "application/json" } })

const MiB = 1024 * 1024

/** Why a change was not saved, for the editor to show. */
const refusal = (status: 413 | 429, message: string) =>
  new Response(message, { status })

/** Thrown to roll back a change that makes the library too large. */
class LibraryFull extends Error {}

const changeBudget = createRateLimiter({
  limit: LIBRARY_CHANGES_PER_MINUTE,
  windowMs: 60_000,
})

/**
 * The team library as a JSON array of items, newest first. Members only:
 * guests never see it.
 */
export const getLibrary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => libraryResponse(await readLibraryJson(db)))

/**
 * Adds and removes items, so members editing at once never overwrite each
 * other. Re-adding an item replaces it in place. Answers with the new library
 * like `getLibrary`, or a refusal (413, 429) whose text says why. Removes save
 * even when the library is over its cap, so members can bring it back under.
 */
export const changeLibrary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({ add: z.array(libraryItem), remove: z.array(z.string()) }),
  )
  .handler(async ({ data, context }) => {
    if (!changeBudget.allow(context.session.user.id, Date.now()))
      return refusal(429, "Too many library changes. Try again in a minute.")
    if (
      data.add.some(
        (item) =>
          Buffer.byteLength(JSON.stringify(item)) > MAX_LIBRARY_ITEM_BYTES,
      )
    )
      return refusal(
        413,
        `This item is too large for the team library. Each item can be up to ${MAX_LIBRARY_ITEM_BYTES / MiB} MB.`,
      )

    let json: string
    try {
      json = await db.transaction(async (tx) => {
        // One change at a time, so concurrent adds can't each fit the cap
        // alone and pass it together. Plain reads still run.
        await tx.execute(
          sql`lock table ${libraryItems} in share row exclusive mode`,
        )
        if (data.remove.length > 0)
          await tx
            .delete(libraryItems)
            .where(inArray(libraryItems.id, data.remove))
        if (data.add.length > 0)
          await tx
            .insert(libraryItems)
            // `add` is newest first; the last row inserted gets the highest seq.
            .values(
              [...data.add].reverse().map((item) => ({ id: item.id, item })),
            )
            .onConflictDoUpdate({
              target: libraryItems.id,
              set: { item: sql`excluded.item` },
            })
        const library = await readLibraryJson(tx)
        if (
          data.add.length > 0 &&
          Buffer.byteLength(library) > MAX_LIBRARY_BYTES
        )
          throw new LibraryFull()
        return library
      })
    } catch (error) {
      if (!(error instanceof LibraryFull)) throw error
      return refusal(
        413,
        `The team library is full (${MAX_LIBRARY_BYTES / MiB} MB). Remove some items to add more.`,
      )
    }
    listUpdates.notify(LIBRARY_CHANGED)
    return libraryResponse(json)
  })
