import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
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
import { changeEmail } from "@/features/account/server"
import { EmailSection } from "./EmailSection"

// The server module imports the db — stub the server-function edge.
vi.mock("@/features/account/server", () => ({
  getCurrentUser: vi.fn(),
  updateProfile: vi.fn(),
  changeEmail: vi.fn(),
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

beforeEach(async () => {
  const { toast } = await import("sonner")
  vi.mocked(toast.success).mockClear()
  vi.mocked(changeEmail).mockReset().mockResolvedValue({ ok: true })
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)

function renderSection() {
  queryClient = new QueryClient()
  queryClient.setQueryData(currentUserQueryOptions().queryKey, user)
  render(
    <QueryClientProvider client={queryClient}>
      <EmailSection user={user} />
    </QueryClientProvider>,
  )
}

function fillAndSubmit(email: string, password = "hunter22") {
  fireEvent.change(screen.getByLabelText("New email"), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole("button", { name: /change email/i }))
}

test("shows the current sign-in email", () => {
  renderSection()
  expect(screen.getByText(/maciek@example\.com/)).not.toBeNull()
})

test("submitting calls changeEmail and clears the form on success", async () => {
  renderSection()
  fillAndSubmit("new@example.com")
  await waitFor(() =>
    expect(changeEmail).toHaveBeenCalledWith({
      data: { newEmail: "new@example.com", currentPassword: "hunter22" },
    }),
  )
  const { toast } = await import("sonner")
  await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled())
  const emailInput = screen.getByLabelText("New email") as HTMLInputElement
  const passwordInput = screen.getByLabelText(
    "Current password",
  ) as HTMLInputElement
  expect(emailInput.value).toBe("")
  expect(passwordInput.value).toBe("")
  // The Account page and sidebar read the currentUser cache — a change must
  // mark it stale so they refetch the new email.
  expect(
    queryClient.getQueryState(currentUserQueryOptions().queryKey)
      ?.isInvalidated,
  ).toBe(true)
})

test("an invalid email surfaces inline without hitting the server", async () => {
  renderSection()
  fillAndSubmit("not-an-email")
  await screen.findByText(/valid email/i)
  expect(changeEmail).not.toHaveBeenCalled()
})

test("a wrong current password shows an inline error and allows a retry", async () => {
  vi.mocked(changeEmail).mockResolvedValueOnce({
    ok: false,
    error: "invalid-password",
  })
  renderSection()
  fillAndSubmit("new@example.com", "wrong-pass")
  await screen.findByText("Incorrect password")

  // Correcting the password must let the form submit again.
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "right-pass" },
  })
  fireEvent.click(screen.getByRole("button", { name: /change email/i }))
  await waitFor(() => expect(changeEmail).toHaveBeenCalledTimes(2))
  const { toast } = await import("sonner")
  await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled())
})

test("a taken email shows an inline error on the email field", async () => {
  vi.mocked(changeEmail).mockResolvedValueOnce({
    ok: false,
    error: "email-taken",
  })
  renderSection()
  fillAndSubmit("taken@example.com")
  await screen.findByText(/already in use/i)
})

test("the submit button shows a pending state while the change is in flight", async () => {
  let resolveChange!: () => void
  vi.mocked(changeEmail).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveChange = () => resolve({ ok: true })
      }),
  )
  renderSection()
  fillAndSubmit("new@example.com")
  await screen.findByRole("button", { name: /changing/i })
  resolveChange()
  await screen.findByRole("button", { name: /change email/i })
})
