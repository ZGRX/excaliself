import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, expect, test, vi } from "vitest"
import {
  useMoveDrawingToFolder,
  useRenameDrawing,
  useTrashDrawing,
} from "./mutations"
import type { Drawing } from "./queries"

const { toastMock, serverMocks } = vi.hoisted(() => {
  const toastMock = Object.assign(
    vi.fn(() => "toast-1"),
    {
      error: vi.fn(),
      dismiss: vi.fn(),
    },
  )
  const serverMocks = {
    getDrawings: vi.fn(),
    getDrawingWithFiles: vi.fn(),
    createDrawing: vi.fn(),
    updateDrawing: vi.fn(),
    setDrawingStarred: vi.fn(),
    saveDrawingScene: vi.fn(),
    trashDrawing: vi.fn(),
    restoreDrawing: vi.fn(),
  }
  return { toastMock, serverMocks }
})

vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("./server", () => serverMocks)

function makeDrawing(id: string, updatedAt: Date): Drawing {
  return {
    id,
    name: `Drawing ${id}`,
    searchText: "",
    folderId: null,
    space: "private",
    createdBy: "user-1",
    creator: { name: "Ada", initials: "A", image: null },
    deletedBy: null,
    starred: false,
    deletedAt: null,
    trashRootId: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

const d1 = makeDrawing("d1", new Date("2026-01-02"))
const d2 = makeDrawing("d2", new Date("2026-01-01"))

function setup() {
  const queryClient = new QueryClient()
  queryClient.setQueryData<Drawing[]>(["drawings"], [d1, d2])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useTrashDrawing(), { wrapper })
  return { queryClient, trash: result.current }
}

const flush = () => act(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
})

test("trashing removes the drawing from the cache instantly and shows an undo toast", async () => {
  serverMocks.trashDrawing.mockReturnValue(new Promise(() => {}))
  const { queryClient, trash } = setup()

  act(() => trash(d1))
  await flush()

  // Cache pruned before the server ever answers — tier-1 instant
  expect(queryClient.getQueryData<Drawing[]>(["drawings"])).toEqual([d2])
  expect(toastMock).toHaveBeenCalledWith(
    "Moved to trash",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
  expect(toastMock.error).not.toHaveBeenCalled()
})

test("undo re-adds the drawing in recency order and calls restore", async () => {
  serverMocks.trashDrawing.mockResolvedValue(undefined)
  serverMocks.restoreDrawing.mockResolvedValue(undefined)
  const { queryClient, trash } = setup()

  act(() => trash(d1))
  await flush()

  const options = toastMock.mock.calls.at(0)?.at(1) as unknown as {
    action: { onClick: () => void }
  }
  act(() => options.action.onClick())
  await flush()

  // react-query passes its own context object as a second argument
  expect(serverMocks.restoreDrawing).toHaveBeenCalledWith(
    { data: "d1" },
    expect.anything(),
  )
  // Back exactly where it was: d1 is newer than d2, so it leads again
  expect(queryClient.getQueryData<Drawing[]>(["drawings"])).toEqual([d1, d2])
})

test("a failed rename rolls the cache back and shows an error toast", async () => {
  serverMocks.updateDrawing.mockRejectedValue(new Error("boom"))
  const queryClient = new QueryClient()
  queryClient.setQueryData<Drawing[]>(["drawings"], [d1, d2])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useRenameDrawing(), { wrapper })

  act(() =>
    result.current.mutate({
      data: { id: "d1", updateData: { name: "Renamed" } },
    }),
  )
  await flush()

  expect(queryClient.getQueryData<Drawing[]>(["drawings"])).toEqual([d1, d2])
  expect(toastMock.error).toHaveBeenCalledWith("Failed to rename")
})

test("moving to a folder patches the cache before the server answers", async () => {
  serverMocks.updateDrawing.mockReturnValue(new Promise(() => {}))
  const queryClient = new QueryClient()
  queryClient.setQueryData<Drawing[]>(["drawings"], [d1, d2])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useMoveDrawingToFolder(), { wrapper })

  act(() =>
    result.current.mutate({
      data: { id: "d1", updateData: { folderId: "f1" } },
    }),
  )
  await flush()

  expect(
    queryClient
      .getQueryData<Drawing[]>(["drawings"])
      ?.find((d) => d.id === "d1")?.folderId,
  ).toBe("f1")
  expect(toastMock.error).not.toHaveBeenCalled()
})

test("a failed move rolls the cache back and shows an error toast", async () => {
  serverMocks.updateDrawing.mockRejectedValue(new Error("boom"))
  const queryClient = new QueryClient()
  queryClient.setQueryData<Drawing[]>(["drawings"], [d1, d2])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useMoveDrawingToFolder(), { wrapper })

  act(() =>
    result.current.mutate({
      data: { id: "d1", updateData: { folderId: "f1" } },
    }),
  )
  await flush()

  expect(queryClient.getQueryData<Drawing[]>(["drawings"])).toEqual([d1, d2])
  expect(toastMock.error).toHaveBeenCalledWith("Failed to move")
})

test("a failed trash rolls the cache back, drops the undo toast and shows an error", async () => {
  serverMocks.trashDrawing.mockRejectedValue(new Error("boom"))
  const { queryClient, trash } = setup()

  act(() => trash(d1))
  await flush()

  expect(queryClient.getQueryData<Drawing[]>(["drawings"])).toEqual([d1, d2])
  expect(toastMock.dismiss).toHaveBeenCalledWith("toast-1")
  expect(toastMock.error).toHaveBeenCalledWith("Couldn't move to trash")
})
