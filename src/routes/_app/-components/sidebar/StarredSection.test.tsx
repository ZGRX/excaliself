import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { toast } from "sonner"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { Drawing } from "@/features/drawings/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { getDrawings, setDrawingStarred } from "@/features/drawings/server"
import { StarredSection } from "./StarredSection"

// Cards and rows poll for live sessions (spec §1.5); these tests are not
// about the badge, so the poll answers "nobody".
vi.mock("@/features/collab/server", () => ({
  getLiveDrawings: vi.fn(async () => ({ drawings: [], teamCount: 0 })),
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
  useParams: () => ({}),
}))

// The query modules import the server functions, which import the db — stub
// the server-function edge.
vi.mock("@/features/drawings/server", () => ({
  getDrawings: vi.fn(),
  getDrawingWithFiles: vi.fn(),
  setDrawingStarred: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}))

// SidebarProvider's useIsMobile needs matchMedia, which jsdom doesn't provide.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(setDrawingStarred).mockResolvedValue(undefined)
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

// Mirrors DrawSidebar: the section gets the drawings list from the query cache
function Harness() {
  const { data: drawings = [] } = useQuery(drawingsQueryOptions())
  return <StarredSection drawings={drawings} />
}

function renderSection(drawings: Drawing[]) {
  // Post-mutation invalidation refetches through the stubbed server fn — have
  // it serve the same fixture the cache was seeded with
  vi.mocked(getDrawings).mockResolvedValue(drawings)
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(drawingsQueryOptions().queryKey, drawings)
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <Harness />
      </SidebarProvider>
    </QueryClientProvider>,
  )
}

test("renders nothing when no drawing is starred", () => {
  renderSection([makeDrawing({ id: "a" }), makeDrawing({ id: "b" })])
  expect(screen.queryByText("Starred")).toBeNull()
})

test("lists only starred drawings, linking to the drawing", () => {
  renderSection([
    makeDrawing({ id: "a", starred: true, name: "Roadmap" }),
    makeDrawing({ id: "b", name: "Unstarred" }),
  ])
  expect(screen.getByText("Starred")).toBeTruthy()
  const link = screen.getByRole("link", { name: /Roadmap/ })
  expect(link.getAttribute("href")).toBe("/draw/a")
  expect(screen.queryByText("Unstarred")).toBeNull()
})

test("unstarring the last starred drawing removes the section", async () => {
  // A never-settling server call proves the removal is optimistic
  vi.mocked(setDrawingStarred).mockReturnValue(new Promise(() => {}))
  renderSection([makeDrawing({ id: "a", starred: true, name: "Roadmap" })])
  fireEvent.click(screen.getByRole("button", { name: "Unstar Roadmap" }))
  await waitFor(() => expect(screen.queryByText("Starred")).toBeNull())
  expect(vi.mocked(setDrawingStarred).mock.calls[0][0]).toEqual({
    data: { id: "a", starred: false },
  })
})

test("a failed unstar rolls back and shows an error toast", async () => {
  vi.mocked(setDrawingStarred).mockRejectedValue(new Error("boom"))
  renderSection([makeDrawing({ id: "a", starred: true, name: "Roadmap" })])
  fireEvent.click(screen.getByRole("button", { name: "Unstar Roadmap" }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Failed to unstar"),
  )
  expect(screen.getByText("Starred")).toBeTruthy()
  expect(screen.getByText("Roadmap")).toBeTruthy()
})
