import type {
  ExcalidrawImperativeAPI,
  LibraryItem,
} from "@excalidraw/excalidraw/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { useTeamLibrary } from "./use-team-library"

const item = (id: string): LibraryItem => ({
  id,
  status: "unpublished",
  elements: [],
  created: 0,
})

// Stands in for an `#addLibrary` link: installs once it gets an editor.
vi.mock("@excalidraw/excalidraw", async () => {
  const { useEffect } = await import("react")
  return {
    useHandleLibrary: ({
      excalidrawAPI,
    }: {
      excalidrawAPI: ExcalidrawImperativeAPI | null
    }) =>
      useEffect(() => {
        void excalidrawAPI?.updateLibrary({
          libraryItems: [item("installed")],
          merge: true,
        })
      }, [excalidrawAPI]),
  }
})

let answerLoad: (items: LibraryItem[]) => void = () => {}
vi.mock("./server", () => ({
  getLibrary: () =>
    new Promise((resolve) => {
      answerLoad = (items) => resolve(Response.json(items))
    }),
  changeLibrary: vi.fn(),
}))

afterEach(cleanup)

test("an install waits for the team library, so showing it can't replace the install", async () => {
  const updateLibrary = vi.fn()
  const excalidrawAPI = { updateLibrary } as unknown as ExcalidrawImperativeAPI
  const queryClient = new QueryClient()
  renderHook(() => useTeamLibrary(excalidrawAPI), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  expect(updateLibrary).not.toHaveBeenCalled()

  await act(async () => answerLoad([item("team")]))
  await waitFor(() => expect(updateLibrary).toHaveBeenCalledTimes(2))

  // Excalidraw applies updates in call order: the install merges on top.
  expect(updateLibrary.mock.calls.map(([update]) => update)).toEqual([
    { libraryItems: [item("team")] },
    { libraryItems: [item("installed")], merge: true },
  ])
})
