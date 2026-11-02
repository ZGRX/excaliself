import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import {
  type CurrentUser,
  deleteAccountStateQueryOptions,
} from "@/features/account/queries"
import {
  deleteMyAccount,
  getDeleteAccountState,
  getMyContentCounts,
} from "@/features/account/server"
import { DangerZoneSection } from "./DangerZoneSection"

// The query module imports the server functions, which import the db — stub
// the server-function edge (the state cache is seeded, so most are never
// called).
vi.mock("@/features/account/server", () => ({
  getCurrentUser: vi.fn(),
  listActiveSessions: vi.fn(),
  getDeleteAccountState: vi.fn(),
  getMyContentCounts: vi.fn(),
  deleteMyAccount: vi.fn(),
}))

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: toastMock }))

const viewer: CurrentUser = {
  id: "user-ada",
  email: "ada@example.com",
  name: "",
  role: "user",
  hasPassword: true,
  teamEnabled: false,
}

// jsdom doesn't implement navigation — swap in a plain object so the
// success redirect is observable instead of a console error.
beforeAll(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "" },
  })
})

beforeEach(() => {
  vi.mocked(getDeleteAccountState).mockReset()
  vi.mocked(getMyContentCounts).mockReset()
  vi.mocked(deleteMyAccount).mockReset()
  toastMock.error.mockReset()
  window.location.href = ""
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(() => {
  cleanup()
})

function renderSection({ soleAdmin = false, user = viewer } = {}) {
  // retry: false so a mocked query rejection reaches error state promptly.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(deleteAccountStateQueryOptions().queryKey, {
    soleAdmin,
  })
  vi.mocked(getDeleteAccountState).mockResolvedValue({ soleAdmin })
  return render(
    <QueryClientProvider client={queryClient}>
      <DangerZoneSection user={user} />
    </QueryClientProvider>,
  )
}

const flush = () => act(async () => {})

const deleteButton = () =>
  screen.getByRole("button", { name: "Delete account" }) as HTMLButtonElement

test("offers a single enabled Delete account action", () => {
  renderSection()

  expect(screen.getByText("Danger zone")).toBeTruthy()
  expect(deleteButton().disabled).toBe(false)
  expect(screen.getByText(/permanently delete your account/i)).toBeTruthy()
})

test("with Team on, the card says Team drawings stay", () => {
  renderSection({ user: { ...viewer, teamEnabled: true } })

  expect(screen.getByText(/Team drawings stay/)).toBeTruthy()
  expect(
    screen.getByText(/all of your private drawings and folders/),
  ).toBeTruthy()
})

test("Delete account runs the tier-3 confirm with own counts, then signs out to login", async () => {
  vi.mocked(getMyContentCounts).mockResolvedValue({
    drawings: 3,
    folders: 1,
    teamDrawings: 0,
  })
  vi.mocked(deleteMyAccount).mockResolvedValue(undefined)
  renderSection()

  fireEvent.click(deleteButton())
  await flush()

  // With no Team drawings the copy names only what is destroyed.
  expect(
    await screen.findByText(
      "This will delete your account and permanently delete your 3 drawings and 1 folder. This can't be undone.",
    ),
  ).toBeTruthy()

  // Armed only by typing the exact email.
  const confirm = () =>
    screen
      .getAllByRole("button", { name: "Delete account" })
      .at(-1) as HTMLButtonElement
  expect(confirm().disabled).toBe(true)
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "ada@example" },
  })
  expect(confirm().disabled).toBe(true)
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "ada@example.com" },
  })
  expect(confirm().disabled).toBe(false)

  fireEvent.click(confirm())
  await flush()

  expect(deleteMyAccount).toHaveBeenCalledTimes(1)
  expect(window.location.href).toBe("/login")
})

test("a failed deletion keeps the dialog open and explains via toast", async () => {
  vi.mocked(getMyContentCounts).mockResolvedValue({
    drawings: 0,
    folders: 0,
    teamDrawings: 0,
  })
  vi.mocked(deleteMyAccount).mockRejectedValue(new Error("boom"))
  renderSection()

  fireEvent.click(deleteButton())
  // Confirm stays gated until the counts land in the danger copy.
  expect(
    await screen.findByText(
      "This will delete your account. You have no drawings or folders. This can't be undone.",
    ),
  ).toBeTruthy()

  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "ada@example.com" },
  })
  fireEvent.click(
    screen
      .getAllByRole("button", { name: "Delete account" })
      .at(-1) as HTMLButtonElement,
  )
  await flush()

  expect(deleteMyAccount).toHaveBeenCalledTimes(1)
  expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete your account")
  // Still open for a retry or a cancel.
  expect(screen.getByRole("textbox")).toBeTruthy()
  expect(window.location.href).toBe("")
})

test("the sole admin is blocked with an explanation instead of a dead control", () => {
  renderSection({ soleAdmin: true })

  expect(deleteButton().disabled).toBe(true)
  // The control says why (issue #67) — promote someone else first.
  expect(screen.getByText(/only admin/i)).toBeTruthy()
  expect(screen.getByText(/promote/i)).toBeTruthy()
})

test("the confirm counts only Private items and says Team drawings stay", async () => {
  vi.mocked(getMyContentCounts).mockResolvedValue({
    drawings: 3,
    folders: 1,
    teamDrawings: 2,
  })
  renderSection()

  fireEvent.click(deleteButton())

  expect(
    await screen.findByText(
      "This will delete your account and permanently delete your 3 drawings and 1 folder. This can't be undone. Your 2 Team drawings stay with the team.",
    ),
  ).toBeTruthy()
})

test("with only Team work the confirm says nothing private is destroyed", async () => {
  vi.mocked(getMyContentCounts).mockResolvedValue({
    drawings: 0,
    folders: 0,
    teamDrawings: 1,
  })
  renderSection()

  fireEvent.click(deleteButton())

  expect(
    await screen.findByText(
      "This will delete your account. You have no private drawings or folders. This can't be undone. Your 1 Team drawing stays with the team.",
    ),
  ).toBeTruthy()
})
