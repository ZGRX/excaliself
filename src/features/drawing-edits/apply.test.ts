import { expect, test } from "vitest"
import { isStale, withEdit } from "./apply"

const el = (id: string, version: number, versionNonce = 1) => ({
  id,
  version,
  versionNonce,
})

test("stale once a changed element moved on or is gone", () => {
  const scene = [el("a", 3), el("b", 1)]
  const base = (version: number, versionNonce = 1) => ({
    version,
    versionNonce,
  })
  expect(isStale(scene, { a: base(3) })).toBe(false)
  expect(isStale(scene, { a: base(2) })).toBe(true)
  expect(isStale(scene, { c: base(1) })).toBe(true)
  // Another edit at the same version: its nonce tells it apart.
  expect(isStale(scene, { a: base(3, 2) })).toBe(true)
})

test("replaces changed elements in place and puts new ones on top", () => {
  const scene = [el("a", 3), el("b", 1)]
  expect(withEdit(scene, [el("new", 1), el("a", 4)])).toEqual([
    el("a", 4),
    el("b", 1),
    el("new", 1),
  ])
})
