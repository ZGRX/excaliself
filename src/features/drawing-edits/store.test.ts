import { expect, test } from "vitest"
import {
  CLAIM_LEASE_MS,
  createEditStore,
  EDIT_TTL_MS,
  type ProposedEdit,
} from "./store"

const proposal = (overrides: Partial<ProposedEdit> = {}): ProposedEdit => ({
  drawingId: "d1",
  userId: "u1",
  client: "Claude",
  summary: "Add a CDN",
  changes: ['Add rectangle "CDN"'],
  elements: [],
  base: {},
  ...overrides,
})

test("a new proposal replaces the member's open one on that drawing", () => {
  const store = createEditStore()
  const first = store.propose(proposal())
  const other = store.propose(proposal({ userId: "u2" }))
  const second = store.propose(proposal())

  expect(first.status).toBe("replaced")
  expect(store.pending("u1", "d1")?.id).toBe(second.id)
  expect(store.pending("u2", "d1")?.id).toBe(other.id)
})

test("the first decision wins, and only the member can make it", () => {
  const store = createEditStore()
  const edit = store.propose(proposal())

  expect(store.decide(edit.id, "u2", "applied")).toBe(false)
  expect(store.decide(edit.id, "u1", "discarded")).toBe(true)
  expect(store.decide(edit.id, "u1", "applied")).toBe(false)
  expect(store.get(edit.id, "u1")?.status).toBe("discarded")
  expect(store.pending("u1", "d1")).toBeNull()
})

test("a tab claims before it applies; the claim shuts out other tabs and newer proposals", () => {
  const store = createEditStore()
  const edit = store.propose(proposal())
  expect(store.decide(edit.id, "u1", "applied")).toBe(false)
  expect(store.decide(edit.id, "u1", "applying")).toBe(true)

  // A second tab, and a newer proposal, find it taken.
  expect(store.decide(edit.id, "u1", "applying")).toBe(false)
  expect(store.decide(edit.id, "u1", "discarded")).toBe(false)
  store.propose(proposal())
  expect(store.get(edit.id, "u1")?.status).toBe("applying")

  expect(store.decide(edit.id, "u1", "stale")).toBe(true)
  expect(store.get(edit.id, "u1")?.status).toBe("stale")
})

test("a wait ends on the outcome, not on the claim or the timeout", async () => {
  const store = createEditStore()
  const edit = store.propose(proposal())
  const waiting = store.wait(edit.id, "u1", 60_000)
  store.decide(edit.id, "u1", "applying")
  store.decide(edit.id, "u1", "applied")
  expect((await waiting)?.status).toBe("applied")
  expect(await store.wait(edit.id, "u2", 10)).toBeNull()
})

test("a wait with no decision returns it still pending", async () => {
  const store = createEditStore()
  const edit = store.propose(proposal())
  expect((await store.wait(edit.id, "u1", 5))?.status).toBe("pending")
})

test("an undecided proposal expires and can no longer be applied", () => {
  let now = 0
  const store = createEditStore(() => now)
  const edit = store.propose(proposal())
  now = EDIT_TTL_MS + 1

  expect(store.pending("u1", "d1")).toBeNull()
  expect(store.decide(edit.id, "u1", "applying")).toBe(false)
  expect(store.get(edit.id, "u1")?.status).toBe("expired")
})

test("a claim the tab never settles ends unconfirmed", () => {
  let now = 0
  const store = createEditStore(() => now)
  const edit = store.propose(proposal())
  store.decide(edit.id, "u1", "applying")
  now = CLAIM_LEASE_MS + 1

  expect(store.get(edit.id, "u1")?.status).toBe("unconfirmed")
  expect(store.decide(edit.id, "u1", "applied")).toBe(false)
})
