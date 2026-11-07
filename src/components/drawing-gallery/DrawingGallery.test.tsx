import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render as renderBare,
  screen,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import type { Drawing } from "@/features/drawings/queries"
import type { Folder } from "@/features/folders/queries"
import { DrawingGallery } from "./DrawingGallery"
import { renderPreviewSvg } from "./preview"

// Cards poll for live sessions (spec §1.5); these tests are not about the
// badge, so the poll answers "nobody".
vi.mock("@/features/collab/server", () => ({
  getLiveDrawings: vi.fn(async () => ({ drawings: [], teamCount: 0 })),
}))

// Each card fetches its own scene for the preview.
vi.mock("@/features/drawings/server", () => ({
  getDrawingScene: vi.fn(async () => "{}"),
}))

/**
 * Every card runs the live poll's `useQuery`, so it needs a client — and
 * `rerender` has to keep the same one, or the second render loses it.
 */
const render = (ui: React.ReactElement) => {
  const client = new QueryClient()
  const wrap = (node: React.ReactElement) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  )
  const result = renderBare(wrap(ui))
  return {
    ...result,
    rerender: (node: React.ReactElement) => result.rerender(wrap(node)),
  }
}

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
}))

// jsdom cannot rasterize Excalidraw scenes — assert cards, not pixels.
vi.mock("./preview", () => ({
  renderPreviewSvg: vi.fn(),
}))

// Radix's popper positions the open menu with ResizeObserver, which jsdom
// doesn't implement.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  }
})

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

const projectsFolder: Folder = {
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
}

const defaultProps = {
  isPending: false,
  loadingLabel: "Loading drawings",
  onTrash: vi.fn(),
  empty: <p>Nothing here</p>,
}

test("renders every drawing newest-edited first, whatever the cache order", () => {
  const drawings = Array.from({ length: 10 }, (_, i) =>
    makeDrawing({ id: `d${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1 + i)) }),
  )
  const shuffled = [drawings[3], ...drawings.filter((_, i) => i !== 3)]

  render(<DrawingGallery {...defaultProps} drawings={shuffled} />)

  const cards = screen.getAllByRole("link")
  expect(cards.map((card) => card.getAttribute("href"))).toEqual(
    Array.from({ length: 10 }, (_, i) => `/draw/d${9 - i}`),
  )
})

test("limit caps the grid after sorting", () => {
  const drawings = Array.from({ length: 5 }, (_, i) =>
    makeDrawing({ id: `d${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1 + i)) }),
  )

  render(<DrawingGallery {...defaultProps} drawings={drawings} limit={2} />)

  expect(
    screen.getAllByRole("link").map((card) => card.getAttribute("href")),
  ).toEqual(["/draw/d4", "/draw/d3"])
})

test("the sort prop reorders the grid", () => {
  const drawings = [
    makeDrawing({
      id: "b",
      name: "Banana",
      createdAt: new Date(1000),
      updatedAt: new Date(3000),
    }),
    makeDrawing({
      id: "a",
      name: "Apple",
      createdAt: new Date(3000),
      updatedAt: new Date(1000),
    }),
    makeDrawing({
      id: "c",
      name: "Cherry",
      createdAt: new Date(2000),
      updatedAt: new Date(2000),
    }),
  ]
  const hrefs = () =>
    screen.getAllByRole("link").map((card) => card.getAttribute("href"))

  const { rerender } = render(
    <DrawingGallery {...defaultProps} drawings={drawings} sort="name" />,
  )
  expect(hrefs()).toEqual(["/draw/a", "/draw/b", "/draw/c"])

  rerender(
    <DrawingGallery
      {...defaultProps}
      drawings={drawings}
      sort="date-created"
    />,
  )
  expect(hrefs()).toEqual(["/draw/a", "/draw/c", "/draw/b"])

  rerender(<DrawingGallery {...defaultProps} drawings={drawings} />)
  expect(hrefs()).toEqual(["/draw/b", "/draw/c", "/draw/a"])
})

test("cards show name, folder attribution, and relative edit time", () => {
  render(
    <DrawingGallery
      {...defaultProps}
      drawings={[
        makeDrawing({
          id: "d1",
          name: "Retro board",
          folderId: "f1",
          updatedAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      ]}
      folders={[projectsFolder]}
    />,
  )

  expect(screen.getByText("Retro board")).toBeTruthy()
  expect(screen.getByText("Projects")).toBeTruthy()
  expect(screen.getByText(/5m ago/)).toBeTruthy()
})

// Spec §5.3: the attribution chip is the folder page's entry point.
test("folder attribution links to the folder page, the card to its drawing", () => {
  render(
    <DrawingGallery
      {...defaultProps}
      drawings={[
        makeDrawing({ id: "d1", name: "Retro board", folderId: "f1" }),
      ]}
      folders={[projectsFolder]}
    />,
  )

  expect(
    screen.getByRole("link", { name: "Projects" }).getAttribute("href"),
  ).toBe("/folder/f1")
  expect(
    screen.getByRole("link", { name: "Retro board" }).getAttribute("href"),
  ).toBe("/draw/d1")
})

test("without a folders prop, attribution stays off even for filed drawings", () => {
  render(
    <DrawingGallery
      {...defaultProps}
      drawings={[makeDrawing({ id: "d1", name: "Filed", folderId: "f1" })]}
    />,
  )

  expect(screen.getByText("Filed")).toBeTruthy()
  expect(screen.queryByText("Projects")).toBeNull()
})

// Spec stories 34, 36, 37: Team cards name their creator; Private ones don't.
test("a Team card shows its creator's initials, with their name on hover", async () => {
  render(
    <DrawingGallery
      {...defaultProps}
      drawings={[
        makeDrawing({
          id: "d1",
          space: "team",
          creator: { name: "Ada Lovelace", initials: "AL", image: null },
        }),
      ]}
    />,
  )

  const avatar = screen.getByRole("img", { name: "Created by Ada Lovelace" })
  expect(avatar.textContent).toBe("AL")

  fireEvent.mouseEnter(avatar)
  expect(await screen.findByText("Ada Lovelace")).toBeTruthy()
})

test("a Team card whose creator was deleted shows Former member", async () => {
  render(
    <DrawingGallery
      {...defaultProps}
      drawings={[
        makeDrawing({
          id: "d1",
          space: "team",
          createdBy: null,
          creator: null,
        }),
      ]}
    />,
  )

  const avatar = screen.getByRole("img", { name: "Created by Former member" })
  fireEvent.mouseEnter(avatar)
  expect(await screen.findByText("Former member")).toBeTruthy()
})

test("a Private card shows no creator", () => {
  render(
    <DrawingGallery {...defaultProps} drawings={[makeDrawing({ id: "d1" })]} />,
  )

  expect(screen.queryByRole("img", { name: /^Created by/ })).toBeNull()
})

test("the empty slot renders only when loaded and empty", () => {
  const { rerender } = render(
    <DrawingGallery {...defaultProps} drawings={[]} isPending />,
  )
  expect(screen.queryByText("Nothing here")).toBeNull()

  rerender(<DrawingGallery {...defaultProps} drawings={[]} />)
  expect(screen.getByText("Nothing here")).toBeTruthy()

  rerender(
    <DrawingGallery {...defaultProps} drawings={[makeDrawing({ id: "d1" })]} />,
  )
  expect(screen.queryByText("Nothing here")).toBeNull()
})

// Spec §4.3: skeletons appear only after ~150 ms so cache hits render
// instantly — no skeleton flash on fast loads.
test("the skeleton grid appears only after the 150ms grace period", () => {
  vi.useFakeTimers()
  render(<DrawingGallery {...defaultProps} drawings={[]} isPending />)

  expect(screen.queryByRole("status")).toBeNull()

  act(() => vi.advanceTimersByTime(149))
  expect(screen.queryByRole("status")).toBeNull()

  act(() => vi.advanceTimersByTime(1))
  const loading = screen.getByRole("status", { name: "Loading drawings" })
  expect(
    loading.querySelectorAll('[data-slot="skeleton"]').length,
  ).toBeGreaterThan(0)
})

test("a load finishing inside the grace period never flashes a skeleton", () => {
  vi.useFakeTimers()
  const { rerender } = render(
    <DrawingGallery {...defaultProps} drawings={[]} isPending />,
  )

  act(() => vi.advanceTimersByTime(100))
  rerender(
    <DrawingGallery {...defaultProps} drawings={[makeDrawing({ id: "d1" })]} />,
  )
  act(() => vi.advanceTimersByTime(500))

  expect(screen.queryByRole("status")).toBeNull()
  expect(screen.getAllByRole("link")).toHaveLength(1)
})

test("skeleton cards mirror the loaded grid and stay static under reduced motion", () => {
  vi.useFakeTimers()
  render(<DrawingGallery {...defaultProps} drawings={[]} isPending limit={3} />)
  act(() => vi.advanceTimersByTime(150))

  const loading = screen.getByRole("status")
  const skeletons = loading.querySelectorAll('[data-slot="skeleton"]')
  expect(skeletons.length).toBeGreaterThanOrEqual(3)
  for (const skeleton of skeletons) {
    expect(skeleton.className).toContain("motion-reduce:animate-none")
  }
})

// Spec §5.11: "Move to trash" is identical everywhere — tier-1 destructive,
// no confirm dialog; the mutation behind onTrash shows the undo toast.
test("the card overflow menu moves its drawing to trash without a confirm dialog", () => {
  const onTrash = vi.fn()
  const drawings = [makeDrawing({ id: "d1" }), makeDrawing({ id: "d2" })]

  render(
    <DrawingGallery {...defaultProps} drawings={drawings} onTrash={onTrash} />,
  )

  // jsdom has no real pointer events; the pointerdown+click pair opens the menu
  const trigger = screen.getByRole("button", { name: "Actions for Drawing d2" })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole("menuitem", { name: /move to trash/i }))

  expect(onTrash).toHaveBeenCalledTimes(1)
  expect(onTrash).toHaveBeenCalledWith(drawings[1])
  expect(screen.queryByRole("alertdialog")).toBeNull()
})

test("every card gets its own actions trigger", () => {
  render(
    <DrawingGallery
      {...defaultProps}
      drawings={[
        makeDrawing({ id: "d1", name: "Retro board" }),
        makeDrawing({ id: "d2", name: "Wireframes" }),
      ]}
    />,
  )

  expect(
    screen.getByRole("button", { name: "Actions for Retro board" }),
  ).toBeTruthy()
  expect(
    screen.getByRole("button", { name: "Actions for Wireframes" }),
  ).toBeTruthy()
})

test("the loaded grid fades in instead of swapping in a single frame", () => {
  const { container } = render(
    <DrawingGallery {...defaultProps} drawings={[makeDrawing({ id: "d1" })]} />,
  )

  const grid = container.firstElementChild
  expect(grid?.className).toContain("animate-in")
  expect(grid?.className).toContain("fade-in-0")
})
