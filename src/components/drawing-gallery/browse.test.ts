import { describe, expect, test } from "vitest"
import type { Drawing } from "@/features/drawings/queries"
import { compareDrawings, filterDrawings } from "./browse"

function makeDrawing(overrides: Partial<Drawing> & { id: string }): Drawing {
  return {
    name: `Drawing ${overrides.id}`,
    searchText: "",
    folderId: null,
    space: "private",
    createdBy: "user-1",
    creator: { name: "Ada", initials: "A", image: null },
    deletedBy: null,
    starred: false,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  }
}

describe("filterDrawings", () => {
  const retro = makeDrawing({ id: "d1", name: "Retro board", folderId: "f1" })
  const roadmap = makeDrawing({ id: "d2", name: "Roadmap", folderId: "f2" })
  const sketch = makeDrawing({ id: "d3", name: "Loose sketch", folderId: null })
  const all = [retro, roadmap, sketch]

  test("empty query and All scope keep everything", () => {
    expect(filterDrawings(all, { query: "", scope: "all" })).toEqual(all)
  })

  test("query matches name case-insensitively as a substring", () => {
    expect(filterDrawings(all, { query: "ROAD", scope: "all" })).toEqual([
      roadmap,
    ])
    expect(filterDrawings(all, { query: "o", scope: "all" })).toEqual(all)
  })

  test("surrounding whitespace in the query is ignored", () => {
    expect(filterDrawings(all, { query: "  retro  ", scope: "all" })).toEqual([
      retro,
    ])
    expect(filterDrawings(all, { query: "   ", scope: "all" })).toEqual(all)
  })

  test("query also matches text inside the scene", () => {
    const flow = makeDrawing({
      id: "d4",
      name: "Untitled",
      searchText: "Login flow",
    })
    expect(
      filterDrawings([...all, flow], { query: "login", scope: "all" }),
    ).toEqual([flow])
  })

  test("Unfiled scope keeps only drawings without a folder", () => {
    expect(filterDrawings(all, { query: "", scope: "unfiled" })).toEqual([
      sketch,
    ])
  })

  test("a folder scope keeps only that folder's drawings", () => {
    expect(
      filterDrawings(all, { query: "", scope: { folderId: "f1" } }),
    ).toEqual([retro])
  })

  test("query and scope compose", () => {
    expect(
      filterDrawings(all, { query: "board", scope: { folderId: "f1" } }),
    ).toEqual([retro])
    expect(
      filterDrawings(all, { query: "roadmap", scope: { folderId: "f1" } }),
    ).toEqual([])
  })
})

describe("compareDrawings", () => {
  test("last-edited orders newest updatedAt first", () => {
    const older = makeDrawing({ id: "a", updatedAt: new Date(1000) })
    const newer = makeDrawing({ id: "b", updatedAt: new Date(2000) })
    expect([older, newer].sort(compareDrawings("last-edited"))).toEqual([
      newer,
      older,
    ])
  })

  test("date-created orders newest createdAt first", () => {
    const older = makeDrawing({
      id: "a",
      createdAt: new Date(1000),
      updatedAt: new Date(9000),
    })
    const newer = makeDrawing({
      id: "b",
      createdAt: new Date(2000),
      updatedAt: new Date(1000),
    })
    expect([older, newer].sort(compareDrawings("date-created"))).toEqual([
      newer,
      older,
    ])
  })

  test("name orders alphabetically, case-insensitive and number-aware", () => {
    const b = makeDrawing({ id: "1", name: "banana" })
    const a = makeDrawing({ id: "2", name: "Apple" })
    const two = makeDrawing({ id: "3", name: "Sprint 2" })
    const ten = makeDrawing({ id: "4", name: "Sprint 10" })
    expect([ten, b, two, a].sort(compareDrawings("name"))).toEqual([
      a,
      b,
      two,
      ten,
    ])
  })

  test("while searching, title matches lead scene-text matches in sort order", () => {
    const newerByText = makeDrawing({
      id: "a",
      searchText: "map",
      updatedAt: new Date(4000),
    })
    const olderByTitle = makeDrawing({
      id: "b",
      name: "Roadmap",
      updatedAt: new Date(1000),
    })
    const newerByTitle = makeDrawing({
      id: "c",
      name: "Map",
      updatedAt: new Date(3000),
    })
    const olderByText = makeDrawing({
      id: "d",
      searchText: "map",
      updatedAt: new Date(2000),
    })
    expect(
      [newerByText, olderByTitle, newerByTitle, olderByText].sort(
        compareDrawings("last-edited", " MAP "),
      ),
    ).toEqual([newerByTitle, olderByTitle, newerByText, olderByText])
  })

  test("comparators survive string timestamps from a serialized cache", () => {
    const older = makeDrawing({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z" as unknown as Date,
    })
    const newer = makeDrawing({
      id: "b",
      updatedAt: "2026-02-01T00:00:00Z" as unknown as Date,
    })
    expect([older, newer].sort(compareDrawings("last-edited"))).toEqual([
      newer,
      older,
    ])
  })
})
