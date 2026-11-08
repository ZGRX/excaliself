import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"
import { trashDrawings } from "@/features/drawings/bulk-server"
import type { Drawing } from "@/features/drawings/queries"
import { DrawingGallery } from "./DrawingGallery"

vi.mock("@/features/collab/server", () => ({
  getLiveDrawings: vi.fn(async () => ({ drawings: [], teamCount: 0 })),
}))
vi.mock("@/features/drawings/server", () => ({
  getDrawingScene: vi.fn(async () => "{}"),
  setDrawingStarred: vi.fn(),
  updateDrawing: vi.fn(),
}))
vi.mock("@/features/drawings/bulk-server", () => ({
  trashDrawings: vi.fn(async () => {}),
  restoreDrawings: vi.fn(),
  setDrawingsStarred: vi.fn(),
  moveDrawingsToFolder: vi.fn(),
  moveDrawingsToTeam: vi.fn(),
}))
vi.mock("@/features/account/server", () => ({
  getCurrentUser: vi.fn(async () => ({ teamEnabled: false })),
}))
vi.mock("@/features/shares/server", () => ({}))
vi.mock("@/features/folders/server", () => ({
  getFolders: vi.fn(async () => []),
  updateFolder: vi.fn(),
}))
vi.mock("./preview", () => ({ renderPreviewSvg: vi.fn(async () => null) }))
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to: _to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children?: React.ReactNode
  }) => (
    <a href={`/draw/${params?.id}`} {...rest}>
      {children}
    </a>
  ),
}))

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(cleanup)

// Newest first, so the grid shows a, b, c, d.
const drawings = ["a", "b", "c", "d"].map(
  (id, i): Drawing => ({
    id,
    name: `Drawing ${id}`,
    searchText: "",
    folderId: null,
    space: "private",
    createdBy: "user-1",
    creator: null,
    deletedBy: null,
    starred: false,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 10 - i),
  }),
)

function renderGallery() {
  const client = new QueryClient()
  const ui = (shown: Drawing[]) => (
    <QueryClientProvider client={client}>
      <DrawingGallery
        drawings={shown}
        isPending={false}
        loadingLabel="Loading"
        onTrash={() => {}}
        selectable
        empty={null}
      />
    </QueryClientProvider>
  )
  const { rerender } = render(ui(drawings))
  return { show: (shown: Drawing[]) => rerender(ui(shown)) }
}

const box = (id: string) =>
  screen.getByRole("checkbox", { name: `Select Drawing ${id}` })
const checked = () =>
  screen
    .getAllByRole("checkbox")
    .filter((el) => el.getAttribute("aria-checked") === "true")
    .map((el) => el.getAttribute("aria-label"))

test("a select box starts a selection; then a card click selects instead of opening", async () => {
  renderGallery()
  expect(screen.queryByRole("region", { name: "Selected drawings" })).toBeNull()

  fireEvent.click(box("a"))
  const bar = await screen.findByRole("region", { name: "Selected drawings" })
  expect(bar.textContent).toContain("1 selected")

  const opened = fireEvent.click(
    screen.getByRole("link", { name: "Drawing c" }),
  )
  expect(opened).toBe(false)
  expect(checked()).toEqual(["Select Drawing a", "Select Drawing c"])
})

test("shift-click selects the range in grid order; Escape clears", () => {
  renderGallery()
  fireEvent.click(box("d"))
  fireEvent.click(box("b"), { shiftKey: true })
  expect(checked()).toEqual([
    "Select Drawing b",
    "Select Drawing c",
    "Select Drawing d",
  ])

  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(checked()).toEqual([])
  expect(screen.queryByRole("region", { name: "Selected drawings" })).toBeNull()
})

test("Move to trash sends the selection in one call and ends it", async () => {
  renderGallery()
  fireEvent.click(box("a"))
  fireEvent.click(await screen.findByRole("button", { name: "Select all" }))
  fireEvent.click(screen.getByRole("button", { name: "Move to trash" }))

  await waitFor(() =>
    expect(vi.mocked(trashDrawings).mock.calls[0]?.[0]).toEqual({
      data: ["a", "b", "c", "d"],
    }),
  )
  expect(screen.queryByRole("region", { name: "Selected drawings" })).toBeNull()
})

test("a card filtered out leaves the selection, and does not return with it", () => {
  const { show } = renderGallery()
  fireEvent.click(box("a"))
  show(drawings.slice(1))
  fireEvent.click(box("b"))
  show(drawings)
  expect(checked()).toEqual(["Select Drawing b"])
})
