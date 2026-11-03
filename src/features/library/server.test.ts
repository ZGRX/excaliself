// @vitest-environment node
import type { LibraryItem } from "@excalidraw/excalidraw/types"
import { beforeEach, expect, test, vi } from "vitest"
import { libraryItems } from "@/db/schema"

// Server fns without the Start compiler: each one is its validator + handler,
// called as the member in `as`.
const as = vi.hoisted(() => ({ userId: "member" }))
vi.mock("@tanstack/react-start", () => {
  type Chain = {
    middleware: () => Chain
    validator: (schema: { parse(data: unknown): unknown }) => Chain
    handler: (
      fn: (opts: { data: unknown; context: unknown }) => unknown,
    ) => (opts?: { data: unknown }) => unknown
  }
  const chain = (schema?: { parse(data: unknown): unknown }): Chain => ({
    middleware: () => chain(schema),
    validator: (next) => chain(next),
    handler: (fn) => async (opts) =>
      fn({
        data: schema ? schema.parse(opts?.data) : opts?.data,
        context: { session: { user: { id: as.userId } } },
      }),
  })
  return { createServerFn: () => chain() }
})
vi.mock("@/middleware/auth", () => ({ authMiddleware: {} }))
vi.mock("@/db", async () => {
  const { createPreviewDb } = await import("@/db/preview")
  return { db: await createPreviewDb() }
})

const { db } = await import("@/db")
const { changeLibrary, getLibrary } = await import("./server")
const {
  LIBRARY_CHANGES_PER_MINUTE,
  MAX_LIBRARY_BYTES,
  MAX_LIBRARY_ITEM_BYTES,
} = await import("./limits")

/** An item whose JSON is about `bytes` long. */
const item = (id: string, bytes = 100): LibraryItem => ({
  id,
  status: "unpublished",
  created: 0,
  elements: [{ id: "e", type: "text", text: "x".repeat(bytes) } as never],
})

const change = (add: LibraryItem[], remove: string[] = []) =>
  changeLibrary({ data: { add, remove } })

const ids = async (response: Response) =>
  ((await response.json()) as LibraryItem[]).map(({ id }) => id)

let nextUser = 0
beforeEach(async () => {
  // A fresh member per test, so the change budget never carries over.
  as.userId = `member-${nextUser++}`
  await db.delete(libraryItems)
  await change([item("kept")])
})

test("refuses an item over the per-item cap and keeps the library as it was", async () => {
  const response = await change([item("huge", MAX_LIBRARY_ITEM_BYTES)])

  expect(response.status).toBe(413)
  expect(await response.text()).toMatch(/item is too large/)
  expect(await ids(await getLibrary())).toEqual(["kept"])
})

test("refuses an add that takes the library past its cap", async () => {
  const fill = Array.from(
    { length: MAX_LIBRARY_BYTES / MAX_LIBRARY_ITEM_BYTES + 1 },
    (_, i) => item(`fill-${i}`, MAX_LIBRARY_ITEM_BYTES - 1024),
  )
  const response = await change(fill)

  expect(response.status).toBe(413)
  expect(await response.text()).toMatch(/library is full/)
  expect(await ids(await getLibrary())).toEqual(["kept"])
})

test("a library already past its cap still loads in full, and removes still save", async () => {
  // Rows from before the caps: one oversized item, and more than one
  // response could carry once serialized.
  const big = "x".repeat(MAX_LIBRARY_BYTES)
  await db.insert(libraryItems).values([
    { id: "old-1", item: item("old-1", 0) },
    { id: "old-2", item: { ...item("old-2", 0), name: big } },
    { id: "old-3", item: { ...item("old-3", 0), name: big } },
  ])
  expect(await ids(await getLibrary())).toEqual([
    "old-3",
    "old-2",
    "old-1",
    "kept",
  ])

  expect((await change([item("new")])).status).toBe(413)
  const removed = await change([], ["old-2", "old-3"])
  expect(await ids(removed)).toEqual(["old-1", "kept"])
})

test("refuses a member's changes past the per-minute budget", async () => {
  for (let i = 1; i < LIBRARY_CHANGES_PER_MINUTE; i++)
    expect((await change([], ["none"])).status).toBe(200)

  const response = await change([item("late")])
  expect(response.status).toBe(429)
  expect(await ids(await getLibrary())).toEqual(["kept"])

  as.userId = "teammate"
  expect((await change([item("late")])).status).toBe(200)
})
