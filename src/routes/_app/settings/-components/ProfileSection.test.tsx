import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  type CurrentUser,
  currentUserQueryOptions,
} from "@/features/account/queries"
import { updateProfile } from "@/features/account/server"
import { ProfileSection } from "./ProfileSection"

// The query/mutation modules import the server functions, which import the
// db — stub the server-function edge (the admin one comes in via the
// member-list invalidation in useUpdateProfile).
vi.mock("@/features/account/server", () => ({
  getCurrentUser: vi.fn(),
  updateProfile: vi.fn(),
}))
vi.mock("@/features/admin/server", () => ({
  getAllUsers: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const user: CurrentUser = {
  id: "user-1",
  email: "maciek@example.com",
  name: "",
  role: "user",
  hasPassword: true,
  teamEnabled: false,
}

let queryClient: QueryClient

beforeEach(() => {
  vi.mocked(updateProfile).mockReset().mockResolvedValue(undefined)
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)

function renderSection(overrides: Partial<CurrentUser> = {}) {
  const current = { ...user, ...overrides }
  queryClient = new QueryClient()
  queryClient.setQueryData(currentUserQueryOptions().queryKey, current)
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileSection user={current} />
    </QueryClientProvider>,
  )
}

function cachedName() {
  const cached = queryClient.getQueryData<CurrentUser>(
    currentUserQueryOptions().queryKey,
  )
  return cached?.name
}

test("the display-name input falls back to the email prefix as placeholder", () => {
  renderSection()
  const input = screen.getByLabelText("Display name") as HTMLInputElement
  expect(input.value).toBe("")
  expect(input.placeholder).toBe("maciek")
})

test("committing a new name on blur saves it optimistically", async () => {
  renderSection()
  const input = screen.getByLabelText("Display name")
  fireEvent.change(input, { target: { value: "  John Doe  " } })
  fireEvent.blur(input)
  await waitFor(() =>
    expect(updateProfile).toHaveBeenCalledWith(
      { data: { name: "John Doe" } },
      expect.anything(),
    ),
  )
  expect(cachedName()).toBe("John Doe")
})

test("Enter commits the name", async () => {
  renderSection()
  const input = screen.getByLabelText("Display name")
  fireEvent.change(input, { target: { value: "John" } })
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() =>
    expect(updateProfile).toHaveBeenCalledWith(
      { data: { name: "John" } },
      expect.anything(),
    ),
  )
})

test("an unchanged value does not hit the server", async () => {
  renderSection({ name: "John" })
  const input = screen.getByLabelText("Display name")
  fireEvent.blur(input)
  fireEvent.change(input, { target: { value: " John " } })
  fireEvent.blur(input)
  await act(async () => {
    await Promise.resolve()
  })
  expect(updateProfile).not.toHaveBeenCalled()
})

test("clearing the name saves an empty name for the email-prefix fallback", async () => {
  renderSection({ name: "John" })
  const input = screen.getByLabelText("Display name")
  fireEvent.change(input, { target: { value: "" } })
  fireEvent.blur(input)
  await waitFor(() =>
    expect(updateProfile).toHaveBeenCalledWith(
      { data: { name: "" } },
      expect.anything(),
    ),
  )
  expect(cachedName()).toBe("")
})

test("rapid successive saves run in serial so the last edit wins", async () => {
  let resolveFirst!: () => void
  vi.mocked(updateProfile).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = () => resolve(undefined)
      }),
  )
  renderSection()
  const input = screen.getByLabelText("Display name")
  fireEvent.change(input, { target: { value: "First" } })
  fireEvent.blur(input)
  await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1))

  fireEvent.change(input, { target: { value: "Second" } })
  fireEvent.blur(input)
  // The shared mutation scope holds the second RPC until the first settles.
  await act(async () => {
    await Promise.resolve()
  })
  expect(updateProfile).toHaveBeenCalledTimes(1)

  resolveFirst()
  await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(2))
  expect(vi.mocked(updateProfile).mock.calls[1][0]).toEqual({
    data: { name: "Second" },
  })
  await waitFor(() => expect(cachedName()).toBe("Second"))
})

test("a failed save rolls the cache back and shows an error toast", async () => {
  const { toast } = await import("sonner")
  vi.mocked(updateProfile).mockRejectedValue(new Error("boom"))
  renderSection({ name: "Old Name" })
  const input = screen.getByLabelText("Display name")
  fireEvent.change(input, { target: { value: "New Name" } })
  fireEvent.blur(input)
  // The optimistic write is asserted in the success test; the reject here
  // settles too fast to reliably observe the intermediate state.
  await waitFor(() => expect(updateProfile).toHaveBeenCalled())
  await waitFor(() => expect(cachedName()).toBe("Old Name"))
  expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
    "Couldn't save display name",
  )
})
