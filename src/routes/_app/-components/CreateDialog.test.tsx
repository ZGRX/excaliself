import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Space } from "@/db/schema"
import { getCurrentUser } from "@/features/account/server"
import { createDrawing } from "@/features/drawings/server"
import { createFolder } from "@/features/folders/server"
import { CreateDialog } from "./CreateDialog"

const { navigate, routerSearch } = vi.hoisted(() => ({
  navigate: vi.fn(),
  routerSearch: { current: {} as { space?: Space } },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => routerSearch.current,
}))

vi.mock("@/features/account/server", () => ({ getCurrentUser: vi.fn() }))

vi.mock("@/features/drawings/server", () => ({
  createDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  setDrawingStarred: vi.fn(),
  trashDrawing: vi.fn(),
  restoreDrawing: vi.fn(),
}))

vi.mock("@/features/folders/server", () => ({
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  trashFolder: vi.fn(),
  restoreFolder: vi.fn(),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  routerSearch.current = {}
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "user-1",
    email: "ada@example.com",
    name: "",
    role: "user",
    hasPassword: true,
    teamEnabled: false,
  })
})

// Auto-cleanup needs vitest globals, which this repo leaves off; without it
// Radix portals from the previous test linger in document.body.
afterEach(cleanup)

// createDrawing returns a UUID, so mock ids must be UUID-shaped
const NEW_DRAWING_ID = "11111111-1111-1111-1111-111111111111"

test("typing a name and pressing Enter creates the drawing and navigates to its canvas", async () => {
  vi.mocked(createDrawing).mockResolvedValue(NEW_DRAWING_ID)

  render(
    <CreateDialog open onOpenChange={vi.fn()} target={{ kind: "drawing" }} />,
    { wrapper },
  )

  const input = screen.getByPlaceholderText(/drawing name/i)
  fireEvent.change(input, { target: { value: "Retro board" } })
  fireEvent.keyDown(input, { key: "Enter" })

  // react-query appends a { client } argument to mutationFn calls; the
  // payload crossing the server-function edge is the first argument.
  await waitFor(() => expect(createDrawing).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createDrawing).mock.calls[0]?.[0]).toEqual({
    data: { name: "Retro board", folderId: null, space: "private" },
  })
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/draw/$id",
      params: { id: NEW_DRAWING_ID },
    }),
  )
})

test("folder-invoked dialog shows its scope and creates the drawing in that folder", async () => {
  vi.mocked(createDrawing).mockResolvedValue(
    "22222222-2222-2222-2222-222222222222",
  )

  render(
    <CreateDialog
      open
      onOpenChange={vi.fn()}
      target={{ kind: "drawing", folder: { id: "folder-1", name: "Projects" } }}
    />,
    { wrapper },
  )

  expect(screen.getByText("in Projects")).toBeTruthy()

  const input = screen.getByPlaceholderText(/drawing name/i)
  fireEvent.change(input, { target: { value: "Roadmap" } })
  fireEvent.keyDown(input, { key: "Enter" })

  await waitFor(() => expect(createDrawing).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createDrawing).mock.calls[0]?.[0]).toEqual({
    data: { name: "Roadmap", folderId: "folder-1", space: "private" },
  })
})

test("folder target creates a root folder on Enter and does not navigate", async () => {
  vi.mocked(createFolder).mockResolvedValue({
    id: "33333333-3333-3333-3333-333333333333",
    name: "Projects",
    space: "private",
    createdBy: "user-1",
    deletedBy: null,
    parentId: null,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
  const onOpenChange = vi.fn()

  render(
    <CreateDialog
      open
      onOpenChange={onOpenChange}
      target={{ kind: "folder" }}
    />,
    { wrapper },
  )

  const input = screen.getByPlaceholderText(/folder name/i)
  fireEvent.change(input, { target: { value: "Projects" } })
  fireEvent.keyDown(input, { key: "Enter" })

  await waitFor(() => expect(createFolder).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createFolder).mock.calls[0]?.[0]).toEqual({
    data: { name: "Projects", parentId: null, space: "private" },
  })
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(createDrawing).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

test("Escape dismisses the dialog without creating anything", async () => {
  const onOpenChange = vi.fn()

  render(
    <CreateDialog
      open
      onOpenChange={onOpenChange}
      target={{ kind: "drawing" }}
    />,
    { wrapper },
  )

  const input = screen.getByPlaceholderText(/drawing name/i)
  fireEvent.change(input, { target: { value: "Almost created" } })
  fireEvent.keyDown(input, { key: "Escape" })

  await waitFor(() =>
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything()),
  )
  expect(createDrawing).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

// Click-away dismissal funnels through the same Base UI onOpenChange as Escape
// (covered above) and doesn't respond to jsdom's synthetic pointer events, so
// it is exercised in the browser instead of here.

// Regression (caught live): the provider keeps the dialog mounted across
// opens, and a successful create bypassed the name reset — reopening showed
// the stale name and Enter created a duplicate.
test("reopening after a successful create starts with an empty name", async () => {
  vi.mocked(createDrawing).mockResolvedValue(NEW_DRAWING_ID)
  const onOpenChange = vi.fn()

  const { rerender } = render(
    <CreateDialog
      open
      onOpenChange={onOpenChange}
      target={{ kind: "drawing" }}
    />,
    { wrapper },
  )

  const input = screen.getByPlaceholderText(/drawing name/i)
  fireEvent.change(input, { target: { value: "First drawing" } })
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

  rerender(
    <CreateDialog
      open={false}
      onOpenChange={onOpenChange}
      target={{ kind: "drawing" }}
    />,
  )
  rerender(
    <CreateDialog
      open
      onOpenChange={onOpenChange}
      target={{ kind: "drawing" }}
    />,
  )

  const reopened =
    screen.getByPlaceholderText<HTMLInputElement>(/drawing name/i)
  expect(reopened.value).toBe("")
})

test("pressing Enter with an empty name creates nothing", async () => {
  render(
    <CreateDialog open onOpenChange={vi.fn()} target={{ kind: "drawing" }} />,
    { wrapper },
  )

  const input = screen.getByPlaceholderText(/drawing name/i)
  fireEvent.change(input, { target: { value: "   " } })
  fireEvent.keyDown(input, { key: "Enter" })

  expect(createDrawing).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})

test("while browsing Team, the dialog says so and creates in Team", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "user-1",
    email: "ada@example.com",
    name: "",
    role: "user",
    hasPassword: true,
    teamEnabled: true,
  })
  routerSearch.current = { space: "team" }
  vi.mocked(createDrawing).mockResolvedValue(NEW_DRAWING_ID)

  render(
    <CreateDialog open onOpenChange={vi.fn()} target={{ kind: "drawing" }} />,
    { wrapper },
  )

  expect(await screen.findByText("in Team")).toBeTruthy()
  const input = screen.getByPlaceholderText(/drawing name/i)
  fireEvent.change(input, { target: { value: "Team retro" } })
  fireEvent.keyDown(input, { key: "Enter" })

  await waitFor(() => expect(createDrawing).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createDrawing).mock.calls[0]?.[0]).toEqual({
    data: { name: "Team retro", folderId: null, space: "team" },
  })
})
