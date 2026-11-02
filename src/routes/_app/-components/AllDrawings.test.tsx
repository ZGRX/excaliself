import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { renderPreviewSvg } from "@/components/drawing-gallery/preview"
import type { Space } from "@/db/schema"
import { currentUserQueryOptions } from "@/features/account/queries"
import type { Drawing } from "@/features/drawings/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { getDrawings, trashDrawing } from "@/features/drawings/server"
import type { Folder } from "@/features/folders/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { AllDrawings } from "./AllDrawings"

const { openCreateDrawingDialog, openCreateFolderDialog, routerSearch } =
  vi.hoisted(() => ({
    openCreateDrawingDialog: vi.fn(),
    openCreateFolderDialog: vi.fn(),
    routerSearch: { current: {} as { space?: Space } },
  }))

// Cards and rows poll for live sessions (spec §1.5); these tests are not
// about the badge, so the poll answers "nobody".
vi.mock("@/features/collab/server", () => ({
  getLiveDrawings: vi.fn(async () => ({ drawings: [], teamCount: 0 })),
}))

vi.mock("./CreateDialog", () => ({
  useCreateDialog: () => ({ openCreateDrawingDialog, openCreateFolderDialog }),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    children: React.ReactNode
  }) => (
    <a
      href={
        Object.entries(params ?? {}).reduce(
          (path, [key, value]) => path.replace(`$${key}`, value),
          to,
        ) + (search?.space ? `?space=${search.space}` : "")
      }
      {...rest}
    >
      {children}
    </a>
  ),
  useSearch: () => routerSearch.current,
}))

// The current user only matters here for teamEnabled.
vi.mock("@/features/account/server", () => ({ getCurrentUser: vi.fn() }))

// jsdom cannot rasterize Excalidraw scenes — assert cards, not pixels.
vi.mock("@/components/drawing-gallery/preview", () => ({
  renderPreviewSvg: vi.fn(),
}))

// The query modules import the server functions, which import the db — stub
// the server-function edge (the caches are seeded, so they are never called).
vi.mock("@/features/drawings/server", () => ({
  getDrawingScene: vi.fn(async () => "{}"),
  getDrawings: vi.fn(),
  getDrawingWithFiles: vi.fn(),
  // The gallery's Move to trash wiring (useTrashDrawing) binds these
  trashDrawing: vi.fn(),
  restoreDrawing: vi.fn(),
}))

vi.mock("@/features/folders/server", () => ({
  getFolders: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(renderPreviewSvg).mockResolvedValue(null)
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function makeDrawing(overrides: Partial<Drawing> & { id: string }): Drawing {
  return {
    name: `Drawing ${overrides.id}`,
    searchText: "",
    folderId: null,
    space: "private",
    createdBy: "user-1",
    creator: { name: "Ada", initials: "A" },
    deletedBy: null,
    starred: false,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  }
}

function renderAllDrawings({
  drawings = [],
  folders = [],
  isAdmin = false,
  teamEnabled = false,
  space,
}: {
  drawings?: Drawing[]
  folders?: Folder[]
  isAdmin?: boolean
  teamEnabled?: boolean
  /** The `space` search param. */
  space?: Space
} = {}) {
  routerSearch.current = { space }
  // Seeded data is the fixture — keep react-query from refetching it through
  // the stubbed server functions.
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(drawingsQueryOptions().queryKey, drawings)
  client.setQueryData(foldersQueryOptions().queryKey, folders)
  client.setQueryData(currentUserQueryOptions().queryKey, {
    id: "user-1",
    email: "ada@example.com",
    name: "",
    role: "user",
    hasPassword: true,
    teamEnabled,
  })
  const view = render(
    <QueryClientProvider client={client}>
      <AllDrawings isAdmin={isAdmin} />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

test("every drawing renders, newest-edited first — no recents cap", () => {
  const drawings = Array.from({ length: 12 }, (_, i) =>
    makeDrawing({ id: `d${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1 + i)) }),
  )
  const shuffled = [drawings[5], ...drawings.filter((_, i) => i !== 5)]

  renderAllDrawings({ drawings: shuffled })

  const cards = screen.getAllByRole("link")
  expect(cards.map((card) => card.getAttribute("href"))).toEqual(
    Array.from({ length: 12 }, (_, i) => `/draw/d${11 - i}`),
  )
})

function makeFolder(id: string, name: string): Folder {
  return {
    id,
    name,
    space: "private",
    createdBy: "user-1",
    deletedBy: null,
    parentId: null,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

function cardHrefs() {
  // Attribution chips are links too — cards are the /draw/ ones
  return screen
    .getAllByRole("link")
    .map((card) => card.getAttribute("href"))
    .filter((href) => href?.startsWith("/draw/"))
}

test("cards carry folder attribution linking to the folder page in the All view", () => {
  renderAllDrawings({
    drawings: [makeDrawing({ id: "d1", name: "Retro board", folderId: "f1" })],
    folders: [makeFolder("f1", "Projects")],
  })

  const chip = screen.getByRole("link", { name: "Projects" })
  expect(chip.getAttribute("href")).toBe("/folder/f1")
})

test("the tab reads All drawings · Excaliself", () => {
  renderAllDrawings({ drawings: [makeDrawing({ id: "d1" })] })

  expect(document.title).toBe("All drawings · Excaliself")
})

test("the page is headed All drawings", () => {
  renderAllDrawings({ drawings: [makeDrawing({ id: "d1" })] })

  expect(screen.getByRole("heading", { name: /all drawings/i })).toBeTruthy()
})

test("zero drawings shows the illustrated empty state with a working create action", () => {
  renderAllDrawings({ drawings: [] })

  fireEvent.click(
    screen.getByRole("button", { name: /create your first drawing/i }),
  )
  expect(openCreateDrawingDialog).toHaveBeenCalledTimes(1)
  // Argumentless — a leaked click event would masquerade as a folder scope
  expect(openCreateDrawingDialog).toHaveBeenCalledWith()
})

test("admins get the invite variant of the empty state", () => {
  renderAllDrawings({ drawings: [], isAdmin: true })

  expect(screen.getByRole("link", { name: /invite your team/i })).toBeTruthy()
})

// --- Browse toolbar (issue #36) ---

const toolbarFixture = {
  drawings: [
    makeDrawing({
      id: "d1",
      name: "Retro board",
      folderId: "f1",
      createdAt: new Date(Date.UTC(2026, 0, 3)),
      updatedAt: new Date(Date.UTC(2026, 0, 10)),
    }),
    makeDrawing({
      id: "d2",
      name: "Roadmap",
      folderId: "f2",
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      updatedAt: new Date(Date.UTC(2026, 0, 12)),
    }),
    makeDrawing({
      id: "d3",
      name: "Loose sketch",
      folderId: null,
      createdAt: new Date(Date.UTC(2026, 0, 2)),
      updatedAt: new Date(Date.UTC(2026, 0, 11)),
    }),
  ],
  folders: [makeFolder("f1", "Projects"), makeFolder("f2", "Archive")],
}

test("typing in search filters the grid in place", () => {
  renderAllDrawings(toolbarFixture)

  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "road" },
  })

  expect(cardHrefs()).toEqual(["/draw/d2"])
  // Still the browse page — search never navigates
  expect(screen.getByRole("heading", { name: /all drawings/i })).toBeTruthy()
})

test("folder chips scope the grid: All / per-folder / Unfiled", () => {
  renderAllDrawings(toolbarFixture)

  fireEvent.click(screen.getByRole("button", { name: "Projects" }))
  expect(cardHrefs()).toEqual(["/draw/d1"])

  fireEvent.click(screen.getByRole("button", { name: "Unfiled" }))
  expect(cardHrefs()).toEqual(["/draw/d3"])

  fireEvent.click(screen.getByRole("button", { name: "All" }))
  expect(cardHrefs()).toEqual(["/draw/d2", "/draw/d3", "/draw/d1"])
})

test("the selected chip is marked pressed", () => {
  renderAllDrawings(toolbarFixture)

  expect(
    screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
  ).toBe("true")

  fireEvent.click(screen.getByRole("button", { name: "Projects" }))
  expect(
    screen
      .getByRole("button", { name: "Projects" })
      .getAttribute("aria-pressed"),
  ).toBe("true")
  expect(
    screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
  ).toBe("false")
})

test("folder attribution shows only in the All view", () => {
  renderAllDrawings(toolbarFixture)

  fireEvent.click(screen.getByRole("button", { name: "Projects" }))

  expect(screen.getByRole("link", { name: /retro board/i })).toBeTruthy()
  expect(screen.queryByRole("link", { name: "Projects" })).toBeNull()
})

test("search composes with the chip scope", () => {
  renderAllDrawings(toolbarFixture)

  fireEvent.click(screen.getByRole("button", { name: "Projects" }))
  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "retro" },
  })
  expect(cardHrefs()).toEqual(["/draw/d1"])

  // Roadmap exists but lives outside the scoped folder
  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "roadmap" },
  })
  expect(screen.queryAllByRole("link")).toEqual([])
})

test("the sort dropdown reorders the grid: Last edited default, Date created, Name", () => {
  renderAllDrawings(toolbarFixture)

  // Default: last edited, newest first
  expect(cardHrefs()).toEqual(["/draw/d2", "/draw/d3", "/draw/d1"])

  const trigger = screen.getByRole("button", { name: /sort/i })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }))
  expect(cardHrefs()).toEqual(["/draw/d3", "/draw/d1", "/draw/d2"])

  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Date created" }))
  expect(cardHrefs()).toEqual(["/draw/d1", "/draw/d3", "/draw/d2"])
})

test("empty search results show the quiet tier-2 line, not the illustration", () => {
  renderAllDrawings(toolbarFixture)

  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "zzz" },
  })

  expect(screen.getByText("No drawings match “zzz”")).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: /create your first drawing/i }),
  ).toBeNull()
})

test("an empty chip scope shows a quiet line, never the illustration", () => {
  renderAllDrawings({
    drawings: [makeDrawing({ id: "d1", folderId: "f1" })],
    folders: [makeFolder("f1", "Projects"), makeFolder("f2", "Empty one")],
  })

  fireEvent.click(screen.getByRole("button", { name: "Empty one" }))
  expect(screen.getByText("This folder is empty")).toBeTruthy()

  // Spec §5.10 pairs the folder line with its contextual action
  fireEvent.click(screen.getByRole("button", { name: /new drawing here/i }))
  expect(openCreateDrawingDialog).toHaveBeenCalledWith({
    id: "f2",
    name: "Empty one",
  })

  fireEvent.click(screen.getByRole("button", { name: "Unfiled" }))
  expect(screen.getByText("No unfiled drawings")).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: /create your first drawing/i }),
  ).toBeNull()
})

// Spec §5.11 / issue #52: Move to trash from a card is tier-1 destructive —
// no dialog, the card leaves the grid optimistically, and the page's own
// search/filter state survives untouched.
test("Move to trash removes the card in place and keeps the active search", async () => {
  renderAllDrawings(toolbarFixture)

  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "r" },
  })
  expect(cardHrefs()).toEqual(["/draw/d2", "/draw/d1"])

  // jsdom has no real pointer events; the pointerdown+click pair opens the menu
  const trigger = screen.getByRole("button", { name: "Actions for Roadmap" })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitem", { name: /move to trash/i }))

  // Optimistic: the card is gone before the server answers, no confirm dialog
  expect(screen.queryByRole("alertdialog")).toBeNull()
  await waitFor(() => expect(cardHrefs()).toEqual(["/draw/d1"]))
  // react-query appends its mutation context as a second argument
  expect(vi.mocked(trashDrawing).mock.calls[0]?.[0]).toEqual({ data: "d2" })

  const search = screen.getByRole("searchbox", {
    name: /search/i,
  }) as HTMLInputElement
  expect(search.value).toBe("r")
})

test("a scope whose folder was deleted falls back to the All view", async () => {
  const { client } = renderAllDrawings(toolbarFixture)

  fireEvent.click(screen.getByRole("button", { name: "Projects" }))
  expect(cardHrefs()).toEqual(["/draw/d1"])

  // The folder is deleted from the sidebar: the mutation prunes it and its
  // drawings from both caches while this page holds the stale scope.
  act(() => {
    client.setQueryData(foldersQueryOptions().queryKey, [
      makeFolder("f2", "Archive"),
    ])
    client.setQueryData(
      drawingsQueryOptions().queryKey,
      toolbarFixture.drawings.filter((drawing) => drawing.folderId !== "f1"),
    )
  })

  await waitFor(() => expect(cardHrefs()).toEqual(["/draw/d2", "/draw/d3"]))
  expect(
    screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
  ).toBe("true")
})

test("with zero drawings the toolbar stays hidden and tier-1 owns the page", () => {
  renderAllDrawings({ drawings: [], folders: [makeFolder("f1", "Projects")] })

  expect(screen.queryByRole("searchbox")).toBeNull()
  expect(screen.queryByRole("button", { name: "Projects" })).toBeNull()
  expect(
    screen.getByRole("button", { name: /create your first drawing/i }),
  ).toBeTruthy()
})

test("without folders there is no chip row, but search and sort remain", () => {
  renderAllDrawings({ drawings: [makeDrawing({ id: "d1" })] })

  expect(screen.queryByRole("button", { name: "Unfiled" })).toBeNull()
  expect(screen.queryByRole("button", { name: "All" })).toBeNull()
  expect(screen.getByRole("searchbox", { name: /search/i })).toBeTruthy()
  expect(screen.getByRole("button", { name: /sort/i })).toBeTruthy()
})

test("loading holds the grid with the delayed skeleton, not a spinner", () => {
  vi.useFakeTimers()
  vi.mocked(getDrawings).mockReturnValue(new Promise(() => {}))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(foldersQueryOptions().queryKey, [])
  render(
    <QueryClientProvider client={client}>
      <AllDrawings isAdmin={false} />
    </QueryClientProvider>,
  )

  // Spec §4.3: nothing during the 150ms grace period…
  expect(screen.queryByRole("status")).toBeNull()
  act(() => vi.advanceTimersByTime(150))

  // …then skeleton cards mirroring the grid
  const loading = screen.getByRole("status", { name: /loading/i })
  expect(
    loading.querySelectorAll('[data-slot="skeleton"]').length,
  ).toBeGreaterThan(0)
  expect(
    screen.queryByRole("button", { name: /create your first drawing/i }),
  ).toBeNull()
})

test("while Team is hidden the space param is ignored", () => {
  renderAllDrawings({
    drawings: [makeDrawing({ id: "d1" })],
    folders: [makeFolder("f1", "Projects")],
    teamEnabled: false,
    space: "team",
  })

  expect(cardHrefs()).toEqual(["/draw/d1"])
  expect(screen.getByRole("button", { name: "Projects" })).toBeTruthy()
})

test("with Team on, the grid and folder chips scope to the browsed space", () => {
  const drawings = [
    makeDrawing({ id: "mine", folderId: "f1" }),
    makeDrawing({ id: "ours", space: "team", folderId: "f2" }),
  ]
  const folders = [
    makeFolder("f1", "Sketches"),
    { ...makeFolder("f2", "Roadmap"), space: "team" as const },
  ]

  renderAllDrawings({ drawings, folders, teamEnabled: true })
  expect(cardHrefs()).toEqual(["/draw/mine"])
  expect(screen.getByRole("button", { name: "Sketches" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Roadmap" })).toBeNull()
  cleanup()

  renderAllDrawings({ drawings, folders, teamEnabled: true, space: "team" })
  expect(cardHrefs()).toEqual(["/draw/ours"])
  expect(screen.getByRole("button", { name: "Roadmap" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Sketches" })).toBeNull()
})

// The card around a drawing's stretched link
const card = (name: string) =>
  screen.getByRole("link", { name }).parentElement as HTMLElement

test("with Team on, search covers both spaces and labels each match; clearing it returns to the space", () => {
  renderAllDrawings({
    drawings: [
      makeDrawing({ id: "ours", name: "Roadmap", space: "team" }),
      makeDrawing({ id: "mine", name: "Road trip", folderId: "f1" }),
      makeDrawing({ id: "retro", name: "Retro", space: "team" }),
    ],
    folders: [makeFolder("f1", "Sketches")],
    teamEnabled: true,
    space: "team",
  })
  const search = screen.getByRole("searchbox", { name: /search/i })

  fireEvent.change(search, { target: { value: "road" } })
  expect(cardHrefs()).toEqual(["/draw/ours", "/draw/mine"])
  expect(within(card("Roadmap")).getByText("Team")).toBeTruthy()
  expect(within(card("Road trip")).getByText("Private")).toBeTruthy()
  // The private match keeps its folder attribution
  expect(
    within(card("Road trip")).getByRole("link", { name: "Sketches" }),
  ).toBeTruthy()

  fireEvent.change(search, { target: { value: "" } })
  expect(cardHrefs()).toEqual(["/draw/ours", "/draw/retro"])
  expect(within(card("Roadmap")).queryByText("Team")).toBeNull()
})

test("while Team is hidden, search results carry no space label", () => {
  renderAllDrawings({
    drawings: [makeDrawing({ id: "mine", name: "Road trip" })],
    teamEnabled: false,
  })

  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "road" },
  })
  expect(cardHrefs()).toEqual(["/draw/mine"])
  expect(within(card("Road trip")).queryByText("Private")).toBeNull()
})
