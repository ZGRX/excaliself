import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Drawing } from "@/features/drawings/queries"
import type { Folder } from "@/features/folders/queries"
import { trashFolder, updateFolder } from "@/features/folders/server"
import { CommandPaletteProvider } from "./CommandPalette"
import { FolderPaletteContext } from "./FolderPaletteContext"

const { navigate, toastMock, openCreateDrawingDialog } = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastMock: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
  openCreateDrawingDialog: vi.fn(),
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}))

vi.mock("sonner", () => ({ toast: toastMock }))

vi.mock("@/features/folders/server", () => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  trashFolder: vi.fn(),
  restoreFolder: vi.fn(),
}))

// The palette itself queries drawings and reaches the create dialog and auth
// client — stub those edges too (they import the db / network).
vi.mock("@/features/drawings/server", () => ({
  getDrawings: vi.fn(),
  getDrawingWithFiles: vi.fn(),
  createDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  setDrawingStarred: vi.fn(),
  trashDrawing: vi.fn(),
  restoreDrawing: vi.fn(),
}))

// The palette reads teamEnabled off the current user.
vi.mock("@/features/account/server", () => ({
  getCurrentUser: vi.fn(async () => ({ teamEnabled: false })),
}))

vi.mock("./CreateDialog", () => ({
  useCreateDialog: () => ({
    openCreateDrawingDialog,
    openCreateFolderDialog: vi.fn(),
  }),
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}))

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: "f1",
    name: "Projects",
    space: "private",
    createdBy: "user-1",
    deletedBy: null,
    parentId: null,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

function makeDrawing(overrides: Partial<Drawing> = {}): Drawing {
  return {
    id: "d1",
    name: "Retro board",
    searchText: "",
    folderId: null,
    space: "private",
    createdBy: "user-1",
    creator: { name: "Ada", initials: "A", image: null },
    deletedBy: null,
    starred: false,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

function setup(folders: Folder[], drawings: Drawing[] = []) {
  // Fresh-forever seeded cache: no mount refetch racing the assertions
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  })
  queryClient.setQueryData<Folder[]>(["folders"], folders)
  queryClient.setQueryData<Drawing[]>(["drawings"], drawings)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CommandPaletteProvider>{children}</CommandPaletteProvider>
    </QueryClientProvider>
  )
  render(<FolderPaletteContext folderId="f1" />, { wrapper })
  return { queryClient }
}

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true })
}

// react-query runs onMutate async (it awaits cancelQueries), so optimistic
// cache assertions need a microtask flush after the click
const flush = () => act(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)

test("the palette shows a This folder section above Go to on a folder page", () => {
  setup([makeFolder()])
  openPalette()
  expect(screen.getByText("This folder")).toBeDefined()
  expect(screen.getAllByRole("option").map((r) => r.textContent)).toEqual([
    "New drawing in this folder",
    "Rename folder",
    "Move folder to trash",
    "Home",
    "All drawings",
    "Trash",
    "Settings",
    "New drawing",
    "New folder",
    "Sign out",
  ])
})

test("a folder missing from the live list contributes no section", () => {
  setup([])
  openPalette()
  expect(screen.queryByText("This folder")).toBeNull()
  expect(screen.getAllByRole("option")).toHaveLength(7)
})

test("New drawing in this folder closes the palette into the scoped create dialog", () => {
  setup([makeFolder()])
  openPalette()

  fireEvent.click(
    screen.getByRole("option", { name: "New drawing in this folder" }),
  )

  expect(openCreateDrawingDialog).toHaveBeenCalledWith({
    id: "f1",
    name: "Projects",
  })
  // Selecting closed the palette
  expect(screen.queryByRole("combobox")).toBeNull()
})

test("Rename folder closes the palette into the rename dialog and saves optimistically", async () => {
  vi.mocked(updateFolder).mockReturnValue(new Promise(() => {}))
  const { queryClient } = setup([makeFolder()])
  openPalette()

  fireEvent.click(screen.getByRole("option", { name: "Rename folder" }))

  // Palette gone, rename dialog open with the current name prefilled
  expect(screen.queryByRole("combobox")).toBeNull()
  const input = screen.getByPlaceholderText<HTMLInputElement>(/folder name/i)
  expect(input.value).toBe("Projects")

  fireEvent.change(input, { target: { value: "Client work" } })
  fireEvent.keyDown(input, { key: "Enter" })
  await flush()

  expect(vi.mocked(updateFolder).mock.calls[0]?.[0]).toEqual({
    data: { id: "f1", name: "Client work" },
  })
  // Optimistic: the cache holds the new name before the server answers
  expect(queryClient.getQueryData<Folder[]>(["folders"])?.[0]?.name).toBe(
    "Client work",
  )
})

test("renaming to the same or an empty name saves nothing", () => {
  setup([makeFolder()])
  openPalette()
  fireEvent.click(screen.getByRole("option", { name: "Rename folder" }))

  const input = screen.getByPlaceholderText<HTMLInputElement>(/folder name/i)
  fireEvent.keyDown(input, { key: "Enter" })
  expect(updateFolder).not.toHaveBeenCalled()

  // Reopen: an all-whitespace name is a no-op too
  openPalette()
  fireEvent.click(screen.getByRole("option", { name: "Rename folder" }))
  fireEvent.change(input, { target: { value: "   " } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(updateFolder).not.toHaveBeenCalled()
})

test("Move folder to trash prunes the subtree, shows the undo toast and lands on Home", async () => {
  vi.mocked(trashFolder).mockReturnValue(new Promise(() => {}))
  const { queryClient } = setup(
    [makeFolder(), makeFolder({ id: "f2", name: "Sub", parentId: "f1" })],
    [
      makeDrawing({ id: "d1", folderId: "f2" }),
      makeDrawing({ id: "d2", name: "Unfiled sketch", folderId: null }),
    ],
  )
  openPalette()

  fireEvent.click(screen.getByRole("option", { name: "Move folder to trash" }))
  await flush()

  // The whole subtree goes as one unit: both folders and the nested drawing
  expect(queryClient.getQueryData<Folder[]>(["folders"])).toEqual([])
  expect(
    queryClient.getQueryData<Drawing[]>(["drawings"])?.map((d) => d.id),
  ).toEqual(["d2"])
  expect(toastMock).toHaveBeenCalledWith(
    "Moved to trash",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
  expect(navigate).toHaveBeenCalledWith({ to: "/draw" })
})

test("a failed Home navigation does not cancel the trash", async () => {
  vi.mocked(trashFolder).mockReturnValue(new Promise(() => {}))
  navigate.mockRejectedValueOnce(new Error("navigation blocked"))
  const { queryClient } = setup([makeFolder()])
  openPalette()

  fireEvent.click(screen.getByRole("option", { name: "Move folder to trash" }))
  await flush()

  expect(queryClient.getQueryData<Folder[]>(["folders"])).toEqual([])
  expect(toastMock).toHaveBeenCalledWith(
    "Moved to trash",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
})
