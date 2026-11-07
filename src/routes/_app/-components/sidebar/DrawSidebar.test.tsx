import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
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
import { currentUserQueryOptions } from "@/features/account/queries"
import { getCurrentUser } from "@/features/account/server"
import { getLiveDrawings } from "@/features/collab/server"
import type { Drawing } from "@/features/drawings/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { getDrawings, updateDrawing } from "@/features/drawings/server"
import type { Folder } from "@/features/folders/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { getFolders } from "@/features/folders/server"
import { moveToTeam } from "@/features/spaces/server"
import { ActiveSpaceProvider } from "../ActiveSpace"
import { MoveToTeamProvider } from "../MoveToTeamDialog"
import { DrawSidebar } from "./DrawSidebar"

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useParams: () => ({}),
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  // Not on Home or All drawings, nothing open: the sidebar's own state rules.
  useLocation: () => ({ pathname: "/trash", search: {} }),
  useMatchRoute: () => () => false,
}))

vi.mock("@/features/collab/server", () => ({
  getLiveDrawings: vi.fn(async () => ({ drawings: [], teamCount: 0 })),
}))
vi.mock("@/features/account/server", () => ({ getCurrentUser: vi.fn() }))
vi.mock("@/features/drawings/server", () => ({
  getDrawings: vi.fn(),
  getDrawingWithFiles: vi.fn(),
  updateDrawing: vi.fn(),
  setDrawingStarred: vi.fn(),
  trashDrawing: vi.fn(),
  restoreDrawing: vi.fn(),
}))
vi.mock("@/features/folders/server", () => ({
  getFolders: vi.fn(),
  updateFolder: vi.fn(),
  trashFolder: vi.fn(),
  restoreFolder: vi.fn(),
}))
vi.mock("@/features/spaces/server", () => ({ moveToTeam: vi.fn() }))
const importFiles = vi.fn()
vi.mock("@/features/drawings/import-files", () => ({
  useImportDrawingFiles: () => importFiles,
}))
vi.mock("@/features/shares/server", () => ({ getDrawingShare: vi.fn() }))
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }))
vi.mock("../CommandPalette", () => ({
  useCommandPalette: () => ({ openCommandPalette: vi.fn() }),
}))
const openCreateDrawingDialog = vi.fn()
vi.mock("../CreateDialog", () => ({
  useCreateDialog: () => ({
    openCreateDrawingDialog,
    openCreateFolderDialog: vi.fn(),
  }),
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
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const drawing = (
  id: string,
  name: string,
  over: Partial<Drawing> = {},
): Drawing => ({
  id,
  name,
  searchText: "",
  folderId: null,
  space: "private",
  createdBy: "user-1",
  creator: { name: "Ada", initials: "A", image: null },
  deletedBy: null,
  starred: false,
  deletedAt: null,
  trashRootId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

const folder = (id: string, name: string, over: Partial<Folder> = {}) => ({
  id,
  name,
  space: "private" as const,
  createdBy: "user-1",
  deletedBy: null,
  parentId: null,
  deletedAt: null,
  trashRootId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

const DRAWINGS = [
  drawing("p-sketch", "Weekend sketch", { starred: true }),
  drawing("p-notes", "Meeting notes"),
  drawing("t-roadmap", "Q4 roadmap", { space: "team" }),
  drawing("t-hiring", "Hiring pipeline", { space: "team", starred: true }),
]
const FOLDERS = [folder("t-design", "Design", { space: "team" })]

const user = (teamEnabled: boolean) => ({
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  role: "user" as const,
  image: null,
  hasPassword: true,
  teamEnabled,
})

let drawings: Drawing[]
beforeEach(() => {
  vi.clearAllMocks()
  drawings = DRAWINGS
  vi.mocked(getDrawings).mockImplementation(async () => drawings)
  vi.mocked(getFolders).mockResolvedValue(FOLDERS)
  vi.mocked(moveToTeam).mockResolvedValue([])
  vi.mocked(getLiveDrawings).mockResolvedValue({ drawings: [], teamCount: 0 })
})

function renderSidebar(teamEnabled: boolean) {
  vi.mocked(getCurrentUser).mockResolvedValue(user(teamEnabled))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(currentUserQueryOptions().queryKey, user(teamEnabled))
  client.setQueryData(drawingsQueryOptions().queryKey, drawings)
  client.setQueryData(foldersQueryOptions().queryKey, FOLDERS)
  render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <ActiveSpaceProvider>
          <MoveToTeamProvider>
            <DrawSidebar
              user={{
                id: "u1",
                createdAt: new Date(),
                email: "ada@example.com",
                name: "Ada",
                image: null,
                isAdmin: false,
              }}
            />
          </MoveToTeamProvider>
        </ActiveSpaceProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  )
  return client
}

const segment = (name: "Private" | "Team") =>
  screen.getByRole("button", { name })
const paneOf = (text: string) =>
  screen.getByText(text).closest("[aria-hidden]") as HTMLElement
const dataTransfer = () => ({
  effectAllowed: "",
  dropEffect: "",
  setData: vi.fn(),
})

test("a solo instance gets today's sidebar; the control appears, on Private, once Team turns on", async () => {
  drawings = DRAWINGS.filter((d) => d.space === "private")
  const client = renderSidebar(false)

  expect(screen.queryByRole("button", { name: "Private" })).toBeNull()
  expect(document.querySelector("[inert]")).toBeNull()
  expect(screen.getByText("Meeting notes")).toBeTruthy()

  // The current-user poll brings the flag; no reload.
  act(() => client.setQueryData(currentUserQueryOptions().queryKey, user(true)))
  const privateSegment = await screen.findByRole("button", { name: "Private" })
  expect(privateSegment.getAttribute("aria-pressed")).toBe("true")
  expect(segment("Team").getAttribute("aria-pressed")).toBe("false")
})

test("each space has its own pane, stars and count; the hidden pane is inert", () => {
  renderSidebar(true)

  const privatePane = paneOf("Meeting notes")
  const teamPane = paneOf("Q4 roadmap")
  expect(privatePane.hasAttribute("inert")).toBe(false)
  expect(teamPane.hasAttribute("inert")).toBe(true)
  expect(teamPane.getAttribute("aria-hidden")).toBe("true")
  // Starred: the pane's own space only
  expect(privatePane.textContent).toContain("Weekend sketch")
  expect(privatePane.textContent).not.toContain("Hiring pipeline")
  expect(screen.getAllByText("Hiring pipeline")).toHaveLength(2) // star + row
  expect(teamPane.contains(screen.getAllByText("Hiring pipeline")[0])).toBe(
    true,
  )

  fireEvent.click(segment("Team"))
  expect(teamPane.hasAttribute("inert")).toBe(false)
  expect(privatePane.hasAttribute("inert")).toBe(true)
})

test("the + of a pane creates in that pane's space", () => {
  renderSidebar(true)
  const plus = paneOf("Q4 roadmap").querySelector("button[aria-haspopup]")
  if (!(plus instanceof HTMLElement)) throw new Error("+ not found")
  fireEvent.click(segment("Team"))
  fireEvent.click(plus)
  fireEvent.click(screen.getByRole("menuitem", { name: "New drawing" }))
  expect(openCreateDrawingDialog).toHaveBeenCalledWith(undefined, "team")
})

test("the Team segment shows the server's count of people live in Team", async () => {
  vi.mocked(getLiveDrawings).mockResolvedValue({ drawings: [], teamCount: 2 })
  renderSidebar(true)

  expect(await screen.findByRole("button", { name: /^Team\s*2$/ })).toBeTruthy()
})

test("dropping a private drawing on the Team segment confirms, then shows Team", async () => {
  renderSidebar(true)
  const dt = dataTransfer()
  fireEvent.dragStart(screen.getByText("Meeting notes"), { dataTransfer: dt })
  fireEvent.dragOver(segment("Team"), { dataTransfer: dt })
  fireEvent.drop(segment("Team"), { dataTransfer: dt })

  expect(screen.getByRole("heading").textContent).toBe(
    "Move “Meeting notes” to Team?",
  )
  expect(moveToTeam).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Move to Team" }))

  await waitFor(() => expect(moveToTeam).toHaveBeenCalledTimes(1))
  expect(vi.mocked(moveToTeam).mock.calls[0]?.[0]).toEqual({
    data: { item: { type: "drawing", id: "p-notes" }, folderId: null },
  })
  expect(segment("Team").getAttribute("aria-pressed")).toBe("true")
})

test("holding a drag over Team for 450 ms switches to it, so the drawing can go into a Team folder", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  renderSidebar(true)
  const dt = dataTransfer()
  fireEvent.dragStart(screen.getByText("Meeting notes"), { dataTransfer: dt })
  fireEvent.dragOver(segment("Team"), { dataTransfer: dt })
  act(() => vi.advanceTimersByTime(449))
  expect(segment("Team").getAttribute("aria-pressed")).toBe("false")
  act(() => vi.advanceTimersByTime(1))
  expect(segment("Team").getAttribute("aria-pressed")).toBe("true")

  fireEvent.dragLeave(segment("Team"))
  fireEvent.dragOver(screen.getByText("Design"), { dataTransfer: dt })
  fireEvent.drop(screen.getByText("Design"), { dataTransfer: dt })
  vi.useRealTimers()
  fireEvent.click(screen.getByRole("button", { name: "Move to Team" }))

  await waitFor(() => expect(moveToTeam).toHaveBeenCalledTimes(1))
  expect(vi.mocked(moveToTeam).mock.calls[0]?.[0]).toEqual({
    data: { item: { type: "drawing", id: "p-notes" }, folderId: "t-design" },
  })
})

test("a Team drawing can't be dropped on Private, nor spring-load it", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  renderSidebar(true)
  fireEvent.click(segment("Team"))
  const dt = dataTransfer()
  fireEvent.dragStart(screen.getByText("Q4 roadmap"), { dataTransfer: dt })

  // Not cancelled: the browser shows "no drop" here.
  expect(fireEvent.dragOver(segment("Private"), { dataTransfer: dt })).toBe(
    true,
  )
  act(() => vi.advanceTimersByTime(1000))
  expect(segment("Team").getAttribute("aria-pressed")).toBe("true")

  fireEvent.drop(segment("Private"), { dataTransfer: dt })
  expect(screen.queryByRole("heading")).toBeNull()
  expect(updateDrawing).not.toHaveBeenCalled()
})

test("files dropped from the computer on a folder import into it", () => {
  renderSidebar(true)
  fireEvent.click(segment("Team"))
  const file = new File(["{}"], "Plan.excalidraw")
  const dt = { types: ["Files"], files: [file], dropEffect: "" }

  // Cancelled: the browser shows a copy drop here.
  expect(
    fireEvent.dragOver(screen.getByText("Design"), { dataTransfer: dt }),
  ).toBe(false)
  fireEvent.drop(screen.getByText("Design"), { dataTransfer: dt })

  expect(importFiles).toHaveBeenCalledWith([file], {
    folderId: "t-design",
    space: "team",
  })
})
