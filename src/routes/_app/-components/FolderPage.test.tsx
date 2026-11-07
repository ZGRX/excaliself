import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { renderPreviewSvg } from "@/components/drawing-gallery/preview"
import type { Drawing } from "@/features/drawings/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { getDrawings } from "@/features/drawings/server"
import type { Folder } from "@/features/folders/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { FolderPage } from "./FolderPage"

const { openCreateDrawingDialog, openCreateFolderDialog, navigate } =
  vi.hoisted(() => ({
    openCreateDrawingDialog: vi.fn(),
    openCreateFolderDialog: vi.fn(),
    navigate: vi.fn(),
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
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}))

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

const fixture = {
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
      name: "Archive item",
      folderId: "f2",
      updatedAt: new Date(Date.UTC(2026, 0, 12)),
    }),
    makeDrawing({
      id: "d3",
      name: "Loose sketch",
      folderId: null,
      updatedAt: new Date(Date.UTC(2026, 0, 11)),
    }),
    makeDrawing({
      id: "d4",
      name: "Amp sketch",
      folderId: "f1",
      createdAt: new Date(Date.UTC(2026, 0, 5)),
      updatedAt: new Date(Date.UTC(2026, 0, 8)),
    }),
  ],
  folders: [makeFolder("f1", "Projects"), makeFolder("f2", "Archive")],
}

function renderFolderPage({
  folderId = "f1",
  drawings = fixture.drawings,
  folders = fixture.folders,
}: {
  folderId?: string
  drawings?: Drawing[]
  folders?: Folder[]
} = {}) {
  // Seeded data is the fixture — keep react-query from refetching it through
  // the stubbed server functions.
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(drawingsQueryOptions().queryKey, drawings)
  client.setQueryData(foldersQueryOptions().queryKey, folders)
  const view = render(
    <QueryClientProvider client={client}>
      <FolderPage folderId={folderId} />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

function cardHrefs() {
  return screen
    .getAllByRole("link")
    .map((card) => card.getAttribute("href"))
    .filter((href) => href?.startsWith("/draw/"))
}

test("only this folder's drawings render, newest-edited first", () => {
  renderFolderPage()

  expect(cardHrefs()).toEqual(["/draw/d1", "/draw/d4"])
})

test("the page is headed by the folder name", () => {
  renderFolderPage()

  expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy()
})

test("the tab reads {Folder name} · Excaliself", () => {
  renderFolderPage()

  expect(document.title).toBe("Projects · Excaliself")
})

test("the chip row is hidden; search and sort remain", () => {
  renderFolderPage()

  expect(screen.queryByRole("button", { name: "All" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Unfiled" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Projects" })).toBeNull()
  expect(screen.getByRole("searchbox", { name: /search/i })).toBeTruthy()
  expect(screen.getByRole("button", { name: /sort/i })).toBeTruthy()
})

test("cards carry no folder attribution", () => {
  renderFolderPage()

  expect(screen.queryByRole("link", { name: "Projects" })).toBeNull()
})

test("search filters within the folder only", () => {
  renderFolderPage()

  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "sketch" },
  })

  // "Loose sketch" matches too but lives outside this folder
  expect(cardHrefs()).toEqual(["/draw/d4"])
})

test("empty search results show the quiet line", () => {
  renderFolderPage()

  fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
    target: { value: "zzz" },
  })

  expect(screen.getByText("No drawings match “zzz”")).toBeTruthy()
})

test("the sort dropdown reorders the grid", () => {
  renderFolderPage()

  const trigger = screen.getByRole("button", { name: /sort/i })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }))
  expect(cardHrefs()).toEqual(["/draw/d4", "/draw/d1"])

  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Date created" }))
  expect(cardHrefs()).toEqual(["/draw/d4", "/draw/d1"])
})

test("an empty folder gets tier-2: quiet line + create scoped here", () => {
  renderFolderPage({
    drawings: fixture.drawings.filter((d) => d.folderId !== "f1"),
  })

  expect(screen.getByText("This folder is empty")).toBeTruthy()
  // The toolbar is pointless over an empty folder
  expect(screen.queryByRole("searchbox")).toBeNull()

  fireEvent.click(screen.getByRole("button", { name: /new drawing here/i }))
  expect(openCreateDrawingDialog).toHaveBeenCalledWith({
    id: "f1",
    name: "Projects",
  })
})

test("a folder deleted while the page is open lands on /drawings", async () => {
  const { client } = renderFolderPage()

  act(() => {
    client.setQueryData(foldersQueryOptions().queryKey, [
      makeFolder("f2", "Archive"),
    ])
  })

  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({ to: "/drawings" }),
  )
  // No error screen, no ghost content
  expect(screen.queryByRole("heading")).toBeNull()
})

test("loading holds the grid with the delayed skeleton, not a spinner", () => {
  vi.useFakeTimers()
  vi.mocked(getDrawings).mockReturnValue(new Promise(() => {}))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(foldersQueryOptions().queryKey, fixture.folders)
  render(
    <QueryClientProvider client={client}>
      <FolderPage folderId="f1" />
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
})
