import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FolderInput, Pencil, Star, Trash2 } from "lucide-react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { currentUserQueryOptions } from "@/features/account/queries"
import type { Drawing } from "@/features/drawings/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import type { Folder } from "@/features/folders/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import {
  CommandPalette,
  CommandPaletteProvider,
  type PaletteContextSection,
  usePaletteContextSection,
} from "./CommandPalette"

const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}))

// The query modules import the server functions, which import the db — stub
// the server-function edge (the caches are seeded, so they are never called).
vi.mock("@/features/drawings/server", () => ({
  getDrawings: vi.fn(),
  getDrawingWithFiles: vi.fn(),
}))

vi.mock("@/features/folders/server", () => ({
  getFolders: vi.fn(),
}))

// The current user only matters here for teamEnabled.
vi.mock("@/features/account/server", () => ({ getCurrentUser: vi.fn() }))

const openCreateDrawingDialog = vi.fn()
const openCreateFolderDialog = vi.fn()
vi.mock("./CreateDialog", () => ({
  useCreateDialog: () => ({ openCreateDrawingDialog, openCreateFolderDialog }),
}))

const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut },
}))

const onOpenChange = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)

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

function makeFolder(overrides: Partial<Folder> & { id: string }): Folder {
  return {
    name: `Folder ${overrides.id}`,
    space: "private",
    createdBy: "user-1",
    deletedBy: null,
    parentId: null,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  }
}

function makeClient({
  drawings = [],
  folders = [],
  teamEnabled = false,
}: {
  drawings?: Drawing[]
  folders?: Folder[]
  teamEnabled?: boolean
} = {}) {
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
    name: "Ada",
    role: "user",
    hasPassword: true,
    teamEnabled,
  })
  return client
}

function renderPalette({
  drawings = [],
  folders = [],
  teamEnabled = false,
  contextSection = null,
  provider = false,
}: {
  drawings?: Drawing[]
  folders?: Folder[]
  teamEnabled?: boolean
  contextSection?: PaletteContextSection | null
  provider?: boolean
} = {}) {
  render(
    <QueryClientProvider
      client={makeClient({ drawings, folders, teamEnabled })}
    >
      {provider ? (
        <CommandPaletteProvider>
          <div />
        </CommandPaletteProvider>
      ) : (
        <CommandPalette
          open
          onOpenChange={onOpenChange}
          contextSection={contextSection}
        />
      )}
    </QueryClientProvider>,
  )
}

function renderOpenPalette(
  fixtures: {
    drawings?: Drawing[]
    folders?: Folder[]
    teamEnabled?: boolean
    contextSection?: PaletteContextSection | null
  } = {},
) {
  renderPalette(fixtures)
  return screen.getByRole("combobox")
}

function optionLabels() {
  return screen.getAllByRole("option").map((r) => r.textContent)
}

test("with zero drawings the recents section is absent and the launcher still shows Go to then Actions — never folders", () => {
  renderOpenPalette({
    folders: [makeFolder({ id: "f1", name: "Homes" })],
  })
  expect(optionLabels()).toEqual([
    "Home",
    "All drawings",
    "Trash",
    "Settings",
    "New drawing",
    "New folder",
    "Sign out",
  ])
  expect(screen.queryByText("Drawings")).toBeNull()
})

test("empty input leads with the 5 most recent drawings by last edit, then Go to, then Actions", () => {
  renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", updatedAt: new Date("2026-07-01T00:00:00Z") }),
      makeDrawing({ id: "d2", updatedAt: new Date("2026-07-06T00:00:00Z") }),
      makeDrawing({ id: "d3", updatedAt: new Date("2026-07-03T00:00:00Z") }),
      makeDrawing({ id: "d4", updatedAt: new Date("2026-07-02T00:00:00Z") }),
      makeDrawing({ id: "d5", updatedAt: new Date("2026-07-05T00:00:00Z") }),
      makeDrawing({ id: "d6", updatedAt: new Date("2026-07-04T00:00:00Z") }),
    ],
  })
  expect(optionLabels()).toEqual([
    // d1 is the oldest edit of the six, so it falls off the 5-item launcher
    "Drawing d2",
    "Drawing d5",
    "Drawing d6",
    "Drawing d3",
    "Drawing d4",
    "Home",
    "All drawings",
    "Trash",
    "Settings",
    "New drawing",
    "New folder",
    "Sign out",
  ])
  expect(screen.getByText("Drawings")).toBeDefined()
})

test("Enter with empty input opens the most recently edited drawing", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", updatedAt: new Date("2026-07-01T00:00:00Z") }),
      makeDrawing({ id: "d2", updatedAt: new Date("2026-07-06T00:00:00Z") }),
    ],
  })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(navigate).toHaveBeenCalledWith({
    to: "/draw/$id",
    params: { id: "d2" },
  })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("trashed drawings never appear among the recents", () => {
  renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1" }),
      makeDrawing({
        id: "d2",
        updatedAt: new Date("2026-07-06T00:00:00Z"),
        deletedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ],
  })
  expect(screen.queryByRole("option", { name: "Drawing d2" })).toBeNull()
  expect(screen.getByRole("option", { name: "Drawing d1" })).toBeDefined()
})

test("the Actions section header renders after Go to", () => {
  renderOpenPalette()
  const headers = screen
    .getAllByText(/^(Go to|Actions)$/)
    .map((el) => el.textContent)
  expect(headers).toEqual(["Go to", "Actions"])
})

test("Enter selects the first row, navigates and closes", () => {
  const input = renderOpenPalette()
  fireEvent.keyDown(input, { key: "Enter" })
  expect(navigate).toHaveBeenCalledWith({ to: "/draw", params: undefined })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("arrow keys move the active row before Enter", () => {
  const input = renderOpenPalette()
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "ArrowUp" })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(navigate).toHaveBeenCalledWith({ to: "/drawings", params: undefined })
})

// The list scrolls (max-h + overflow) while jsdom doesn't, so assert the
// scroll calls themselves: keyboard moves keep the active row visible, hover
// must not scroll or the list would yank under the cursor.
test("arrow keys scroll the newly active row into view; hover does not", () => {
  const scrollIntoView = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = scrollIntoView
  try {
    const input = renderOpenPalette()
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })

    scrollIntoView.mockClear()
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Settings" }))
    expect(scrollIntoView).not.toHaveBeenCalled()
  } finally {
    delete (window.HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  }
})

test("arrow keys cross the section boundary into Actions", () => {
  const input = renderOpenPalette()
  for (let i = 0; i < 4; i++) fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(openCreateDrawingDialog).toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

test("clicking a row navigates and closes", () => {
  renderOpenPalette()
  fireEvent.click(screen.getByRole("option", { name: "Trash" }))
  expect(navigate).toHaveBeenCalledWith({ to: "/trash", params: undefined })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("New drawing closes the palette into the create drawing dialog", () => {
  renderOpenPalette()
  fireEvent.click(screen.getByRole("option", { name: "New drawing" }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(openCreateDrawingDialog).toHaveBeenCalledWith()
  expect(openCreateFolderDialog).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

test("New folder closes the palette into the create folder dialog", () => {
  renderOpenPalette()
  fireEvent.click(screen.getByRole("option", { name: "New folder" }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(openCreateFolderDialog).toHaveBeenCalledWith()
  expect(openCreateDrawingDialog).not.toHaveBeenCalled()
})

test("Sign out ends the session and lands on the login page", async () => {
  const location = { href: "" }
  vi.stubGlobal("location", location)
  try {
    renderOpenPalette()
    fireEvent.click(screen.getByRole("option", { name: "Sign out" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(signOut).toHaveBeenCalled()
    await vi.waitFor(() => expect(location.href).toBe("/login"))
  } finally {
    vi.unstubAllGlobals()
  }
})

test("typing filters across both static sections", () => {
  const input = renderOpenPalette()
  fireEvent.change(input, { target: { value: "new" } })
  expect(optionLabels()).toEqual(["New drawing", "New folder"])
  // Go to matched nothing, so its header collapses with it
  expect(screen.queryByText("Go to")).toBeNull()
  fireEvent.keyDown(input, { key: "Enter" })
  expect(openCreateDrawingDialog).toHaveBeenCalled()
})

test("typing filters within the Go to section", () => {
  const input = renderOpenPalette()
  fireEvent.change(input, { target: { value: "set" } })
  expect(optionLabels()).toEqual(["Settings"])
  expect(screen.queryByText("Actions")).toBeNull()
  fireEvent.keyDown(input, { key: "Enter" })
  expect(navigate).toHaveBeenCalledWith({ to: "/settings", params: undefined })
})

test("a query with no matches shows the empty state", () => {
  const input = renderOpenPalette()
  fireEvent.change(input, { target: { value: "zzz" } })
  expect(screen.queryAllByRole("option")).toHaveLength(0)
  expect(screen.getByText("No results")).toBeDefined()
  fireEvent.keyDown(input, { key: "Enter" })
  expect(navigate).not.toHaveBeenCalled()
})

test("typing lists matching drawings under Drawings, above Go to — never interleaved", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", name: "Settings sketch" }),
      makeDrawing({ id: "d2", name: "Roadmap" }),
    ],
  })
  fireEvent.change(input, { target: { value: "set" } })
  // The drawing matches "set" too, but stays in its own section above Go to
  expect(optionLabels()).toEqual(["Settings sketch", "Settings"])
  expect(screen.getByText("Drawings")).toBeDefined()
  expect(screen.getByText("Go to")).toBeDefined()
})

test("a fuzzy subsequence finds a drawing without typing it exactly", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", name: "Roadmap" }),
      makeDrawing({ id: "d2", name: "Sprint retro" }),
    ],
  })
  fireEvent.change(input, { target: { value: "rdmap" } })
  expect(optionLabels()).toEqual(["Roadmap"])
})

test("drawing matches rank best match first, not cache order", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", name: "Roadmap sketches" }),
      makeDrawing({ id: "d2", name: "Map" }),
    ],
  })
  fireEvent.change(input, { target: { value: "map" } })
  // The exact-name match beats the weaker mid-word match despite coming
  // second in the cache
  expect(optionLabels()).toEqual(["Map", "Roadmap sketches"])
})

test("scene-text matches follow title matches and show the matching words", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({
        id: "d1",
        name: "Architecture",
        searchText: "Roadmap review",
      }),
      makeDrawing({ id: "d2", name: "Roadmap" }),
    ],
  })
  fireEvent.change(input, { target: { value: "roadmap" } })
  expect(optionLabels()).toEqual(["Roadmap", "ArchitectureRoadmap review"])
})

test("with Team on, each drawing result says which space it lives in", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", name: "Roadmap", space: "team" }),
      makeDrawing({ id: "d2", name: "Road trip" }),
    ],
    teamEnabled: true,
  })
  fireEvent.change(input, { target: { value: "road" } })
  expect(optionLabels()).toEqual(["RoadmapTeam", "Road tripPrivate"])
})

test("while Team is hidden, drawing results carry no space label", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", name: "Roadmap", space: "team" }),
      makeDrawing({ id: "d2", name: "Road trip" }),
    ],
  })
  fireEvent.change(input, { target: { value: "road" } })
  expect(optionLabels()).toEqual(["Roadmap", "Road trip"])
})

test("selecting a drawing opens it and closes the palette", () => {
  const input = renderOpenPalette({
    drawings: [makeDrawing({ id: "d1", name: "Roadmap" })],
  })
  fireEvent.change(input, { target: { value: "road" } })
  fireEvent.click(screen.getByRole("option", { name: "Roadmap" }))
  expect(navigate).toHaveBeenCalledWith({
    to: "/draw/$id",
    params: { id: "d1" },
  })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("arrow keys cross from Drawings into Go to", () => {
  const input = renderOpenPalette({
    drawings: [makeDrawing({ id: "d1", name: "Settings sketch" })],
  })
  fireEvent.change(input, { target: { value: "set" } })
  fireEvent.keyDown(input, { key: "ArrowDown" })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(navigate).toHaveBeenCalledWith({ to: "/settings", params: undefined })
})

test("trashed drawings never appear, even if a stale cache holds one", () => {
  const input = renderOpenPalette({
    drawings: [
      makeDrawing({ id: "d1", name: "Roadmap" }),
      makeDrawing({
        id: "d2",
        name: "Roadmap old",
        deletedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ],
  })
  fireEvent.change(input, { target: { value: "roadmap" } })
  expect(optionLabels()).toEqual(["Roadmap"])
})

test("a folder-name match surfaces as a dynamic Go to row that navigates to the folder", () => {
  const input = renderOpenPalette({
    folders: [makeFolder({ id: "f1", name: "Sprint plans" })],
  })
  fireEvent.change(input, { target: { value: "sprint" } })
  expect(screen.getByText("Go to")).toBeDefined()
  fireEvent.click(screen.getByRole("option", { name: "Sprint plans" }))
  expect(navigate).toHaveBeenCalledWith({
    to: "/folder/$id",
    params: { id: "f1" },
  })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("folder matches follow the static Go to rows within the section", () => {
  const input = renderOpenPalette({
    folders: [makeFolder({ id: "f1", name: "Trash talk" })],
  })
  fireEvent.change(input, { target: { value: "tra" } })
  expect(optionLabels()).toEqual(["Trash", "Trash talk"])
})

test("sections with no matches collapse entirely", () => {
  const input = renderOpenPalette({
    drawings: [makeDrawing({ id: "d1", name: "Roadmap" })],
  })
  fireEvent.change(input, { target: { value: "road" } })
  expect(optionLabels()).toEqual(["Roadmap"])
  expect(screen.queryByText("Go to")).toBeNull()
  expect(screen.queryByText("Actions")).toBeNull()
})

test("Cmd+K on the provider opens the palette", () => {
  renderPalette({ provider: true })
  expect(screen.queryByRole("combobox")).toBeNull()
  fireEvent.keyDown(window, { key: "k", metaKey: true })
  expect(screen.getByRole("combobox")).toBeDefined()
})

const onRename = vi.fn()
const onStar = vi.fn()
const onTrash = vi.fn()

function makeSection(): PaletteContextSection {
  return {
    title: "This drawing",
    rows: [
      {
        id: "drawing:rename",
        label: "Rename",
        icon: Pencil,
        onSelect: onRename,
      },
      { id: "drawing:star", label: "Star", icon: Star, onSelect: onStar },
      {
        id: "drawing:trash",
        label: "Move to trash",
        icon: Trash2,
        destructive: true,
        onSelect: onTrash,
      },
    ],
  }
}

test("the context section renders above every other section", () => {
  renderOpenPalette({ contextSection: makeSection() })
  expect(optionLabels()).toEqual([
    "Rename",
    "Star",
    "Move to trash",
    "Home",
    "All drawings",
    "Trash",
    "Settings",
    "New drawing",
    "New folder",
    "Sign out",
  ])
  expect(screen.getByText("This drawing")).toBeDefined()
})

test("selecting a context row runs its action and closes the palette", () => {
  renderOpenPalette({ contextSection: makeSection() })
  fireEvent.click(screen.getByRole("option", { name: "Rename" }))
  expect(onRename).toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(navigate).not.toHaveBeenCalled()
})

test("Enter lands on the first context row, not a Go to row", () => {
  const input = renderOpenPalette({ contextSection: makeSection() })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(onRename).toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

test("typing filters context rows and keeps them above drawing matches", () => {
  const input = renderOpenPalette({
    contextSection: makeSection(),
    drawings: [makeDrawing({ id: "d1", name: "Star chart" })],
  })
  fireEvent.change(input, { target: { value: "star" } })
  expect(optionLabels()).toEqual(["Star", "Star chart"])

  fireEvent.change(input, { target: { value: "trash" } })
  // Matches in several sections keep the fixed section order
  expect(optionLabels()).toEqual(["Move to trash", "Trash"])
  expect(screen.queryByText("This drawing")).toBeDefined()
})

const onPickFolder = vi.fn()

function makePickerSection(): PaletteContextSection {
  return {
    title: "This drawing",
    rows: [
      {
        id: "drawing:rename",
        label: "Rename",
        icon: Pencil,
        onSelect: onRename,
      },
      {
        id: "drawing:move-folder",
        label: "Move to folder…",
        icon: FolderInput,
        pickFolder: onPickFolder,
      },
    ],
  }
}

const pickerFolders = [
  makeFolder({ id: "f1", name: "Sprint plans" }),
  makeFolder({ id: "f2", name: "Archive" }),
]

function enterPicker() {
  const input = renderOpenPalette({
    contextSection: makePickerSection(),
    folders: pickerFolders,
  })
  fireEvent.click(screen.getByRole("option", { name: "Move to folder…" }))
  return input
}

test("a pickFolder row swaps the palette to the folder list instead of closing", () => {
  enterPicker()
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(onPickFolder).not.toHaveBeenCalled()
  // Root leads as "No folder", then the folders; every other section is gone
  expect(optionLabels()).toEqual(["No folder", "Sprint plans", "Archive"])
  expect(screen.getByText("Move to folder")).toBeDefined()
  expect(screen.queryByText("Go to")).toBeNull()
  expect(screen.queryByText("This drawing")).toBeNull()
})

test("entering the picker clears the query that found the row", () => {
  const input = renderOpenPalette({
    contextSection: makePickerSection(),
    folders: pickerFolders,
  })
  fireEvent.change(input, { target: { value: "move" } })
  fireEvent.click(screen.getByRole("option", { name: "Move to folder…" }))
  // "move" matches neither folder — a leaked query would empty the picker
  expect(optionLabels()).toEqual(["No folder", "Sprint plans", "Archive"])
  expect((input as HTMLInputElement).value).toBe("")
})

test("the picker filters folders by query, including the No folder row", () => {
  const input = enterPicker()
  fireEvent.change(input, { target: { value: "spr" } })
  expect(optionLabels()).toEqual(["Sprint plans"])

  fireEvent.change(input, { target: { value: "no f" } })
  expect(optionLabels()).toEqual(["No folder"])
})

test("picking a folder closes the palette and reports its id", () => {
  enterPicker()
  fireEvent.click(screen.getByRole("option", { name: "Sprint plans" }))
  expect(onPickFolder).toHaveBeenCalledWith("f1")
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("picking No folder reports null for the root", () => {
  const input = enterPicker()
  fireEvent.keyDown(input, { key: "Enter" })
  expect(onPickFolder).toHaveBeenCalledWith(null)
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test("Backspace on empty input steps back to the main list", () => {
  const input = enterPicker()
  fireEvent.keyDown(input, { key: "Backspace" })
  expect(screen.queryByText("Move to folder")).toBeNull()
  expect(screen.getByText("This drawing")).toBeDefined()
  expect(screen.getByRole("option", { name: "Move to folder…" })).toBeDefined()
  expect(onOpenChange).not.toHaveBeenCalled()
})

test("Backspace with a query keeps the picker open", () => {
  const input = enterPicker()
  fireEvent.change(input, { target: { value: "a" } })
  fireEvent.keyDown(input, { key: "Backspace" })
  expect(screen.getByText("Move to folder")).toBeDefined()
})

function RegisteringChild({ section }: { section: PaletteContextSection }) {
  usePaletteContextSection(section)
  return null
}

test("a route-registered section appears and unregisters on unmount", () => {
  const client = makeClient()
  const section = makeSection()
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <CommandPaletteProvider>
        <RegisteringChild section={section} />
      </CommandPaletteProvider>
    </QueryClientProvider>,
  )
  fireEvent.keyDown(window, { key: "k", metaKey: true })
  expect(screen.getAllByRole("option")).toHaveLength(10)

  rerender(
    <QueryClientProvider client={client}>
      <CommandPaletteProvider>{null}</CommandPaletteProvider>
    </QueryClientProvider>,
  )
  expect(screen.getAllByRole("option")).toHaveLength(7)
  expect(screen.queryByText("This drawing")).toBeNull()
})
