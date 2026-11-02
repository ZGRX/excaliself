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
import type { Space } from "@/db/schema"
import { currentUserQueryOptions } from "@/features/account/queries"
import type { Drawing } from "@/features/drawings/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { getDrawingScene, getDrawings } from "@/features/drawings/server"
import type { Folder } from "@/features/folders/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { Home } from "./Home"

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

vi.mock("../CreateDialog", () => ({
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

// jsdom cannot rasterize Excalidraw scenes — assert the renderer is invoked
// with the right scene, not pixels.
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

function renderHome({
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
  return render(
    <QueryClientProvider client={client}>
      <Home isAdmin={isAdmin} />
    </QueryClientProvider>,
  )
}

test("shows at most the 8 most recently edited drawings, newest first", () => {
  const drawings = Array.from({ length: 10 }, (_, i) =>
    makeDrawing({
      id: `d${i}`,
      name: `Drawing ${i}`,
      // d9 is the most recent, d0 the oldest
      updatedAt: new Date(Date.UTC(2026, 0, 1 + i)),
    }),
  )
  // The server orders by updatedAt, but the cache is mutated in place by
  // autosave without reordering — Home must sort for itself.
  const shuffled = [drawings[3], ...drawings.filter((_, i) => i !== 3)]

  renderHome({ drawings: shuffled })

  // The header's View all link is not a card
  const cards = screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/draw/"))
  expect(cards).toHaveLength(8)
  expect(cards.map((card) => card.getAttribute("href"))).toEqual([
    "/draw/d9",
    "/draw/d8",
    "/draw/d7",
    "/draw/d6",
    "/draw/d5",
    "/draw/d4",
    "/draw/d3",
    "/draw/d2",
  ])
  expect(screen.queryByText("Drawing 1")).toBeNull()
  expect(screen.queryByText("Drawing 0")).toBeNull()
})

test("a card shows the drawing's name, folder, and relative edit time", () => {
  const now = Date.now()
  renderHome({
    drawings: [
      makeDrawing({
        id: "d1",
        name: "Retro board",
        folderId: "f1",
        updatedAt: new Date(now - 5 * 60 * 1000),
      }),
    ],
    folders: [
      {
        id: "f1",
        name: "Projects",
        space: "private",
        createdBy: "user-1",
        deletedBy: null,
        parentId: null,
        deletedAt: null,
        trashRootId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  })

  expect(screen.getByText("Retro board")).toBeTruthy()
  expect(screen.getByText("Projects")).toBeTruthy()
  expect(screen.getByText(/5m ago/)).toBeTruthy()
})

// Regression (caught in review): 360-364 days floored to "0y ago"
test("a drawing edited just under a year ago reads in months, not zero years", () => {
  renderHome({
    drawings: [
      makeDrawing({
        id: "d1",
        updatedAt: new Date(Date.now() - 362 * 24 * 60 * 60 * 1000),
      }),
    ],
  })

  expect(screen.getByText(/11mo ago/)).toBeTruthy()
})

test("a card without a folder omits the folder label", () => {
  renderHome({
    drawings: [makeDrawing({ id: "d1", name: "Loose sketch" })],
    folders: [
      {
        id: "f1",
        name: "Projects",
        space: "private",
        createdBy: "user-1",
        deletedBy: null,
        parentId: null,
        deletedAt: null,
        trashRootId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  })

  expect(screen.getByText("Loose sketch")).toBeTruthy()
  expect(screen.queryByText("Projects")).toBeNull()
})

test("cards link to their drawing's canvas", () => {
  renderHome({ drawings: [makeDrawing({ id: "d1", name: "Retro board" })] })

  const card = screen.getByRole("link", { name: /retro board/i })
  expect(card.getAttribute("href")).toBe("/draw/d1")
})

test("the preview renderer is invoked with each drawing's scene", async () => {
  const scene = JSON.stringify({ elements: [{ type: "rectangle" }] })
  vi.mocked(getDrawingScene).mockResolvedValue(scene)
  renderHome({ drawings: [makeDrawing({ id: "d1" })] })

  await waitFor(() =>
    expect(getDrawingScene).toHaveBeenCalledWith({ data: "d1" }),
  )

  // The renderer module is dynamically imported, so the call lands a tick
  // after mount
  await waitFor(() => expect(renderPreviewSvg).toHaveBeenCalledWith(scene))

  // The resolved SVG lands inside the card
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  vi.mocked(renderPreviewSvg).mockResolvedValue(svg)
  cleanup()
  renderHome({ drawings: [makeDrawing({ id: "d1" })] })
  await screen.findByLabelText(/preview of/i)
})

test("a preview fades in when its render resolves, without flashing the placeholder", async () => {
  let resolveRender!: (svg: SVGSVGElement | null) => void
  vi.mocked(renderPreviewSvg).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRender = resolve
      }),
  )
  renderHome({ drawings: [makeDrawing({ id: "d1" })] })

  // Mid-load: the container is transparent and set up to fade, and the
  // "no preview" pencil is not showing
  const container = screen.getByRole("img")
  expect(container.className).toContain("opacity-0")
  expect(container.className).toContain("transition-opacity")
  expect(container.className).toContain("duration-200")
  expect(container.className).toContain("ease-out")
  expect(screen.queryByLabelText(/no preview/i)).toBeNull()

  // The dynamically imported renderer starts a tick after mount
  await waitFor(() => expect(renderPreviewSvg).toHaveBeenCalled())
  resolveRender(document.createElementNS("http://www.w3.org/2000/svg", "svg"))

  // Resolved: the same container transitions to full opacity
  const ready = await screen.findByLabelText(/preview of/i)
  expect(ready.className).toContain("opacity-100")
  expect(ready.className).not.toContain("opacity-0")
})

test("a drawing whose scene cannot be rendered gets a placeholder card", async () => {
  vi.mocked(renderPreviewSvg).mockResolvedValue(null)
  renderHome({
    drawings: [makeDrawing({ id: "d1", name: "Corrupt one" })],
  })

  expect(await screen.findByLabelText(/no preview/i)).toBeTruthy()
  // The card itself still renders
  expect(screen.getByText("Corrupt one")).toBeTruthy()
})

test("a rejected preview render is contained to a placeholder, not a crash", async () => {
  vi.mocked(renderPreviewSvg).mockRejectedValue(new Error("boom"))
  renderHome({
    drawings: [makeDrawing({ id: "d1", name: "Still here" })],
  })

  expect(await screen.findByLabelText(/no preview/i)).toBeTruthy()
  expect(screen.getByText("Still here")).toBeTruthy()
})

test("View all leads to the browse page once there are drawings", () => {
  renderHome({ drawings: [makeDrawing({ id: "d1" })] })

  const viewAll = screen.getByRole("link", { name: /view all/i })
  expect(viewAll.getAttribute("href")).toBe("/drawings")
})

test("View all is not offered next to the empty state", () => {
  renderHome({ drawings: [] })

  expect(screen.queryByRole("link", { name: /view all/i })).toBeNull()
})

test("the New drawing button opens the Create dialog", () => {
  renderHome({ drawings: [makeDrawing({ id: "d1" })] })

  fireEvent.click(screen.getByRole("button", { name: /new drawing/i }))
  expect(openCreateDrawingDialog).toHaveBeenCalledTimes(1)
})

test("while drawings load, skeleton cards hold the grid — no empty state flash", () => {
  vi.useFakeTimers()
  // No seeded drawings cache: the query goes through the (never-resolving)
  // server function, holding Home in its loading state
  vi.mocked(getDrawings).mockReturnValue(new Promise(() => {}))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(foldersQueryOptions().queryKey, [])
  render(
    <QueryClientProvider client={client}>
      <Home isAdmin={false} />
    </QueryClientProvider>,
  )

  // Spec §4.3: the skeleton waits out the 150ms grace period first
  expect(screen.queryByRole("status")).toBeNull()
  act(() => vi.advanceTimersByTime(150))

  const loading = screen.getByRole("status", { name: /loading/i })
  expect(
    loading.querySelectorAll('[data-slot="skeleton"]').length,
  ).toBeGreaterThan(0)
  expect(
    screen.queryByRole("button", { name: /create your first drawing/i }),
  ).toBeNull()
  expect(screen.queryAllByRole("link")).toHaveLength(0)
})

test("loaded drawings show cards, not skeletons", () => {
  renderHome({ drawings: [makeDrawing({ id: "d1" })] })

  expect(screen.queryByRole("status")).toBeNull()
  expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
})

test("the loaded grid fades in instead of swapping in a single frame", () => {
  renderHome({ drawings: [makeDrawing({ id: "d1", name: "Retro board" })] })

  // link → card div → grid
  const grid = screen.getByRole("link", { name: /retro board/i }).parentElement
    ?.parentElement
  expect(grid?.className).toContain("animate-in")
  expect(grid?.className).toContain("fade-in-0")
})

test("the empty state cascades in: illustration, CTA, then hint", () => {
  renderHome({ drawings: [] })

  const emptyState = screen.getByRole("button", {
    name: /create your first drawing/i,
  }).parentElement
  const children = Array.from(emptyState?.children ?? [])
  expect(children).toHaveLength(3)
  const [illustration, button, hint] = children

  for (const child of children) {
    expect(child.className).toContain("animate-in")
    expect(child.className).toContain("fade-in-0")
    expect(child.className).toContain("slide-in-from-bottom-2")
    expect(child.className).toContain("animation-duration-300")
    // Animation-only easing — the ease-* utilities would restyle the
    // button's hover transition
    expect(child.className).toContain(
      "[animation-timing-function:var(--ease-out)]",
    )
    expect(child.className.split(/\s+/)).not.toContain("ease-out")
    // Later items must be invisible until their delay elapses
    expect(child.className).toContain("fill-mode-backwards")
    // Reduced motion keeps the fade but drops the slide
    expect(child.className).toContain("motion-reduce:slide-in-from-bottom-0")
  }

  // Staggered in DOM order — via the animation-delay variable, because the
  // delay-* utility also sets transition-delay, which would lag the button's
  // hover/press feedback
  expect(illustration.className).not.toContain("--tw-animation-delay")
  expect(button.className).toContain("[--tw-animation-delay:75ms]")
  expect(hint.className).toContain("[--tw-animation-delay:100ms]")

  // The illustration tile additionally zooms from 95% — never from zero
  expect(illustration.className).toContain("zoom-in-95")
  expect(illustration.className).toContain("motion-reduce:zoom-in-100")
})

test("the empty state shows the hand-drawn illustration and the press-N hint", () => {
  renderHome({ drawings: [] })

  const emptyState = screen.getByRole("button", {
    name: /create your first drawing/i,
  }).parentElement
  // The auth panel's illustration, reused: decorative, on the iris tone
  const svg = emptyState?.querySelector('svg[aria-hidden="true"]')
  expect(svg).toBeTruthy()
  expect(svg?.getAttribute("class")).toContain("text-iris")

  expect(screen.getByText(/or press/i).textContent).toBe("or press N anytime")
})

test("zero drawings shows the empty state with a working create action", () => {
  renderHome({ drawings: [] })

  fireEvent.click(
    screen.getByRole("button", { name: /create your first drawing/i }),
  )
  expect(openCreateDrawingDialog).toHaveBeenCalledTimes(1)
  // Argumentless — a leaked click event would masquerade as a folder scope
  expect(openCreateDrawingDialog).toHaveBeenCalledWith()
})

test("members never see the invite action", () => {
  renderHome({ drawings: [], isAdmin: false })

  expect(screen.queryAllByRole("link")).toHaveLength(0)
})

test("admins get a secondary invite action leading to the invites surface", () => {
  renderHome({ drawings: [], isAdmin: true })

  const invite = screen.getByRole("link", { name: /invite your team/i })
  expect(invite.getAttribute("href")).toBe("/settings/invites")

  // It joins the cascade as the last step, after the hint
  expect(invite.className).toContain("animate-in")
  expect(invite.className).toContain("fill-mode-backwards")
  expect(invite.className).toContain("[--tw-animation-delay:150ms]")
  expect(invite.className).toContain("motion-reduce:slide-in-from-bottom-0")
})

const mixedSpaces = [
  makeDrawing({ id: "mine", space: "private" }),
  makeDrawing({ id: "ours", space: "team" }),
]

const cardHrefs = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"))
    .filter((href) => href?.startsWith("/draw/"))

test("while Team is hidden the space param is ignored", () => {
  renderHome({ drawings: mixedSpaces, teamEnabled: false, space: "team" })

  expect(cardHrefs()).toEqual(["/draw/mine", "/draw/ours"])
  expect(
    screen.getByRole("link", { name: /view all/i }).getAttribute("href"),
  ).toBe("/drawings")
})

test("with Team on, Home shows Private by default", () => {
  renderHome({ drawings: mixedSpaces, teamEnabled: true })

  expect(cardHrefs()).toEqual(["/draw/mine"])
})

test("browsing Team shows Team drawings and View all keeps the scope", () => {
  renderHome({ drawings: mixedSpaces, teamEnabled: true, space: "team" })

  expect(cardHrefs()).toEqual(["/draw/ours"])
  expect(
    screen.getByRole("link", { name: /view all/i }).getAttribute("href"),
  ).toBe("/drawings?space=team")
})

test("an empty Team offers to create there, not the first-run illustration", () => {
  renderHome({
    drawings: [makeDrawing({ id: "mine" })],
    teamEnabled: true,
    space: "team",
  })

  expect(
    screen.queryByRole("button", { name: /create your first drawing/i }),
  ).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "New drawing in Team" }))
  expect(openCreateDrawingDialog).toHaveBeenCalledTimes(1)
})
