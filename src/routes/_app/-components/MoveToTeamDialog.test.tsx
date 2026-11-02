import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { currentUserQueryOptions } from "@/features/account/queries"
import { type Drawing, drawingsQueryOptions } from "@/features/drawings/queries"
import { type Folder, foldersQueryOptions } from "@/features/folders/queries"
import type { MoveItem } from "@/features/spaces/move-to-team"
import { moveToTeam } from "@/features/spaces/server"
import { MoveToTeamProvider, useMoveToTeamDialog } from "./MoveToTeamDialog"

vi.mock("@/features/account/server", () => ({ getCurrentUser: vi.fn() }))
vi.mock("@/features/drawings/server", () => ({ getDrawings: vi.fn() }))
vi.mock("@/features/folders/server", () => ({ getFolders: vi.fn() }))
vi.mock("@/features/shares/server", () => ({ getDrawingShare: vi.fn() }))
vi.mock("@/features/spaces/server", () => ({ moveToTeam: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

// Auto-cleanup needs vitest globals, which this repo leaves off; without it
// portals from the previous test linger in document.body.
afterEach(cleanup)

// Projects ─┬─ Q4 ── Archive ── d-old
//           └─ d-plan, d-notes            Loose: d-loose
// Solo ── Sub ── d-sub    Empty    One ── d-one    Nest ─┬─ A, B
const folders = [
  { id: "f-projects", name: "Projects", parentId: null },
  { id: "f-q4", name: "Q4", parentId: "f-projects" },
  { id: "f-archive", name: "Archive", parentId: "f-q4" },
  { id: "f-solo", name: "Solo", parentId: null },
  { id: "f-solo-sub", name: "Sub", parentId: "f-solo" },
  { id: "f-empty", name: "Empty", parentId: null },
  { id: "f-one", name: "One", parentId: null },
  { id: "f-nest", name: "Nest", parentId: null },
  { id: "f-nest-a", name: "A", parentId: "f-nest" },
  { id: "f-nest-b", name: "B", parentId: "f-nest" },
] as Folder[]
const drawings = [
  { id: "d-plan", name: "Plan", folderId: "f-projects" },
  { id: "d-notes", name: "Notes", folderId: "f-projects" },
  { id: "d-old", name: "Old", folderId: "f-archive" },
  { id: "d-loose", name: "Retro board", folderId: null },
  { id: "d-sub", name: "Sub drawing", folderId: "f-solo-sub" },
  { id: "d-one", name: "One drawing", folderId: "f-one" },
] as Drawing[]

function Opener({
  item,
  flush,
}: {
  item: MoveItem
  flush?: () => Promise<void>
}) {
  const name =
    [...drawings, ...folders].find((row) => row.id === item.id)?.name ?? ""
  const { requestMoveToTeam, registerFlush } = useMoveToTeamDialog()
  useEffect(
    () => (flush ? registerFlush(flush) : undefined),
    [flush, registerFlush],
  )
  if (!requestMoveToTeam) return <p>No Team</p>
  return (
    <button type="button" onClick={() => requestMoveToTeam(item, name)}>
      Open
    </button>
  )
}

function renderOpener(
  item: MoveItem,
  options: { teamEnabled?: boolean; flush?: () => Promise<void> } = {},
) {
  const client = new QueryClient()
  client.setQueryData(currentUserQueryOptions().queryKey, {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    role: "user",
    hasPassword: true,
    teamEnabled: options.teamEnabled ?? true,
  })
  client.setQueryData(drawingsQueryOptions().queryKey, drawings)
  client.setQueryData(foldersQueryOptions().queryKey, folders)
  render(
    <QueryClientProvider client={client}>
      <MoveToTeamProvider>
        <Opener item={item} flush={options.flush} />
      </MoveToTeamProvider>
    </QueryClientProvider>,
  )
}

const title = () => screen.getByRole("heading").textContent
const body = () => screen.getByText(/^All members/).textContent

const open = () => fireEvent.click(screen.getByRole("button", { name: "Open" }))

test("a drawing's confirm says everyone can edit it and it can't come back", () => {
  renderOpener({ type: "drawing", id: "d-loose" })
  open()

  expect(title()).toBe("Move “Retro board” to Team?")
  expect(body()).toBe(
    "All members can see and edit it. You can't move it back to Private.",
  )
  screen.getByRole("button", { name: "Move to Team" })
  screen.getByRole("button", { name: "Cancel" })
})

test("a folder's confirm counts every drawing and folder inside it", () => {
  renderOpener({ type: "folder", id: "f-projects" })
  open()

  expect(title()).toBe("Move “Projects” to Team?")
  expect(body()).toBe(
    "All members can see and edit it. You can't move it back to Private. This also moves the 3 drawings and 2 folders inside it.",
  )
})

test("a folder's counts are singular for one", () => {
  renderOpener({ type: "folder", id: "f-solo" })
  open()

  expect(body()).toBe(
    "All members can see and edit it. You can't move it back to Private. This also moves the 1 drawing and 1 folder inside it.",
  )
})

test.each([
  ["f-one", " This also moves the 1 drawing inside it."],
  ["f-nest", " This also moves the 2 folders inside it."],
  ["f-empty", ""],
])("a folder's count leaves out zero parts (%s)", (id, sentence) => {
  renderOpener({ type: "folder", id })
  open()

  expect(body()).toBe(
    `All members can see and edit it. You can't move it back to Private.${sentence}`,
  )
})

test("confirming flushes the open canvas, then moves to Team root", async () => {
  const order: string[] = []
  const flush = vi.fn(async () => {
    order.push("flush")
  })
  vi.mocked(moveToTeam).mockImplementation(async () => {
    order.push("move")
    return ["d-loose"]
  })
  renderOpener({ type: "drawing", id: "d-loose" }, { flush })
  open()

  fireEvent.click(screen.getByRole("button", { name: "Move to Team" }))

  await waitFor(() => expect(order).toEqual(["flush", "move"]))
  expect(vi.mocked(moveToTeam).mock.calls[0][0]).toEqual({
    data: { item: { type: "drawing", id: "d-loose" }, folderId: null },
  })
})

test("Cancel moves nothing", () => {
  renderOpener({ type: "drawing", id: "d-loose" })
  open()

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

  expect(moveToTeam).not.toHaveBeenCalled()
})

test("no entry point can open the confirm while Team is hidden", () => {
  renderOpener({ type: "drawing", id: "d-loose" }, { teamEnabled: false })

  screen.getByText("No Team")
})
