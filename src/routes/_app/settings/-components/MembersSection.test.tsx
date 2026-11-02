import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { currentUserQueryOptions } from "@/features/account/queries"
import { getCurrentUser } from "@/features/account/server"
import { type AdminUser, usersQueryOptions } from "@/features/admin/queries"
import {
  deleteUser,
  getAllUsers,
  getUserContentCounts,
  setUserRole,
} from "@/features/admin/server"
import { pendingPasswordResetsQueryOptions } from "@/features/password-resets/queries"
import {
  createPasswordReset,
  getPendingPasswordResets,
  revokePasswordReset,
} from "@/features/password-resets/server"
import { MembersSection } from "./MembersSection"

// The query modules import the server functions, which import the db — stub
// the server-function edge (the caches are seeded, so most are never called).
vi.mock("@/features/admin/server", () => ({
  getAllUsers: vi.fn(),
  setUserRole: vi.fn(),
  deleteUser: vi.fn(),
  getUserContentCounts: vi.fn(),
}))
vi.mock("@/features/account/server", () => ({
  getCurrentUser: vi.fn(),
  listActiveSessions: vi.fn(),
}))
vi.mock("@/features/password-resets/server", () => ({
  createPasswordReset: vi.fn(),
  getPendingPasswordResets: vi.fn(),
  revokePasswordReset: vi.fn(),
}))

const { toastMock, navigateMock, invalidateMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  navigateMock: vi.fn(),
  invalidateMock: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: invalidateMock }),
}))

// Deliberately out of join order: Bea (Feb) before ada (Jan) before Cy (Mar).
const members: AdminUser[] = [
  {
    id: "user-bea",
    email: "bea@example.com",
    emailVerified: true,
    name: "Bea",
    image: null,
    role: "user" as const,
    createdAt: new Date("2026-02-01T12:00:00Z"),
    updatedAt: new Date("2026-02-01T12:00:00Z"),
  },
  {
    id: "user-ada",
    email: "ada@example.com",
    emailVerified: true,
    name: "",
    image: null,
    role: "admin" as const,
    createdAt: new Date("2026-01-05T12:00:00Z"),
    updatedAt: new Date("2026-01-05T12:00:00Z"),
  },
  {
    id: "user-cy",
    email: "cy@example.com",
    emailVerified: true,
    name: "Cy",
    image: null,
    role: "user" as const,
    createdAt: new Date("2026-03-10T12:00:00Z"),
    updatedAt: new Date("2026-03-10T12:00:00Z"),
  },
]

// Same instance with Bea promoted, so ada is no longer the last admin.
const twoAdmins: AdminUser[] = members.map((member) =>
  member.id === "user-bea" ? { ...member, role: "admin" as const } : member,
)

// The viewer is ada, the admin browsing /settings/members.
const viewer = {
  id: "user-ada",
  email: "ada@example.com",
  name: "",
  role: "admin" as const,
  hasPassword: true,
  teamEnabled: false,
}

const clipboardWriteText = vi.fn()

// Radix's popper positions the open tooltip with ResizeObserver, which jsdom
// doesn't implement; Radix Select additionally scrolls and pointer-captures.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  }
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
  vi.mocked(setUserRole).mockReset().mockResolvedValue(undefined)
  vi.mocked(getAllUsers).mockReset()
  vi.mocked(deleteUser).mockReset()
  vi.mocked(getUserContentCounts).mockReset()
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(viewer)
  vi.mocked(createPasswordReset).mockReset()
  vi.mocked(revokePasswordReset).mockReset().mockResolvedValue(undefined)
  vi.mocked(getPendingPasswordResets).mockReset().mockResolvedValue([])
  clipboardWriteText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    configurable: true,
  })
  navigateMock.mockReset().mockResolvedValue(undefined)
  invalidateMock.mockReset().mockResolvedValue(undefined)
  toastMock.error.mockReset()
  toastMock.success.mockReset()
})

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderSection({
  seed = true,
  users = members,
  pendingResets = [] as { userId: string }[],
} = {}) {
  // retry: false so a mocked query rejection reaches error state promptly.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (seed) {
    queryClient.setQueryData(usersQueryOptions().queryKey, users)
    vi.mocked(getAllUsers).mockResolvedValue(users)
    queryClient.setQueryData(
      pendingPasswordResetsQueryOptions().queryKey,
      pendingResets,
    )
  }
  queryClient.setQueryData(currentUserQueryOptions().queryKey, viewer)
  return render(
    <QueryClientProvider client={queryClient}>
      <MembersSection />
    </QueryClientProvider>,
  )
}

const flush = () => act(async () => {})

function openRowMenu(name: string) {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
}

// The role control is a Base UI Select: the trigger is a combobox button
// whose text is the current role; picking means open + click an option.
const roleSelect = (displayName: string) =>
  screen.getByRole("combobox", {
    name: `Role for ${displayName}`,
  }) as HTMLButtonElement

function chooseRole(displayName: string, label: string) {
  const trigger = roleSelect(displayName)
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
  // Base UI commits a selection on the full press-release-click sequence
  const option = screen.getByRole("option", { name: label })
  fireEvent.pointerDown(option)
  fireEvent.pointerUp(option)
  fireEvent.click(option)
}

test("the header shows the member count", () => {
  renderSection()
  expect(screen.getByText("3 members")).not.toBeNull()
})

test("a single member is counted in the singular", () => {
  renderSection({ users: [members[1]] })
  expect(screen.getByText("1 member")).not.toBeNull()
})

test("members are listed by join date with display name, email, and joined date", () => {
  renderSection()

  // ada has no display name, so the email prefix stands in (spec §5.12).
  const names = screen
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent)
  expect(names).toEqual(["ada", "Bea", "Cy"])

  expect(screen.getByText("ada@example.com")).not.toBeNull()
  expect(
    screen.getByText(
      `Joined ${new Date("2026-01-05T12:00:00Z").toLocaleDateString()}`,
    ),
  ).not.toBeNull()
})

test("every row carries the shared initials avatar", () => {
  const { container } = renderSection()
  // InitialsAvatar is the decorative initials circle (aria-hidden span).
  expect(
    container.querySelectorAll("span[aria-hidden='true'].rounded-full"),
  ).toHaveLength(3)
})

test("every row except your own offers an actions menu", () => {
  renderSection()
  // Covers both the no-self-delete and sole-admin UI blocks — see the
  // rationale comment in MembersSection.
  expect(screen.queryByRole("button", { name: "Actions for ada" })).toBeNull()
  expect(screen.getByRole("button", { name: "Actions for Bea" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Actions for Cy" })).toBeTruthy()
})

test("Reset password generates a link, copies it, and confirms with a toast", async () => {
  vi.mocked(createPasswordReset).mockResolvedValue({ token: "tok-xyz" })
  renderSection()

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /reset password/i }))

  await waitFor(() => {
    expect(createPasswordReset).toHaveBeenCalledWith({
      data: { userId: "user-bea" },
    })
  })
  await waitFor(() => {
    expect(clipboardWriteText).toHaveBeenCalledWith(
      `${window.location.origin}/reset-password?token=tok-xyz`,
    )
  })
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
})

test("admins can be reset too — another admin's row offers Reset password", async () => {
  vi.mocked(createPasswordReset).mockResolvedValue({ token: "tok-adm" })
  renderSection({ users: twoAdmins })

  // Bea is an admin here; her row still carries the reset action.
  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /reset password/i }))

  await waitFor(() => {
    expect(createPasswordReset).toHaveBeenCalledWith({
      data: { userId: "user-bea" },
    })
  })
})

test("a pending reset shows a row hint with a revoke action", async () => {
  renderSection({ pendingResets: [{ userId: "user-bea" }] })

  // Only Bea's row hints at the outstanding link.
  expect(screen.getAllByText("Reset link pending")).toHaveLength(1)

  fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
  await waitFor(() => {
    expect(revokePasswordReset).toHaveBeenCalledWith(
      { data: { userId: "user-bea" } },
      // react-query passes its mutation context as a second argument.
      expect.anything(),
    )
  })
})

test("rows without a pending reset show no hint or revoke", () => {
  renderSection()
  expect(screen.queryByText("Reset link pending")).toBeNull()
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull()
})

test("Delete user opens the tier-3 dialog with live content counts and an email challenge", async () => {
  vi.mocked(getUserContentCounts).mockResolvedValue({
    drawings: 3,
    folders: 1,
    teamDrawings: 0,
  })
  renderSection()

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /delete user/i }))
  await flush()

  expect(getUserContentCounts).toHaveBeenCalledWith({ data: "user-bea" })
  // With no Team drawings the copy names only what is destroyed.
  expect(
    await screen.findByText(
      "This will delete Bea's account and permanently delete their 3 drawings and 1 folder. This can't be undone.",
    ),
  ).toBeTruthy()

  // Armed only by typing the exact email.
  const confirm = () =>
    screen.getByRole("button", { name: "Delete user" }) as HTMLButtonElement
  expect(confirm().disabled).toBe(true)
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "bea@example" },
  })
  expect(confirm().disabled).toBe(true)
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "bea@example.com" },
  })
  expect(confirm().disabled).toBe(false)
})

test("the delete confirm counts only Bea's Private items and says their Team drawings stay", async () => {
  vi.mocked(getUserContentCounts).mockResolvedValue({
    drawings: 3,
    folders: 1,
    teamDrawings: 2,
  })
  renderSection()

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /delete user/i }))

  expect(
    await screen.findByText(
      "This will delete Bea's account and permanently delete their 3 drawings and 1 folder. This can't be undone. Their 2 Team drawings stay with the team.",
    ),
  ).toBeTruthy()
})

test("with only Team work the delete confirm says nothing private is destroyed", async () => {
  vi.mocked(getUserContentCounts).mockResolvedValue({
    drawings: 0,
    folders: 0,
    teamDrawings: 1,
  })
  renderSection()

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /delete user/i }))

  expect(
    await screen.findByText(
      "This will delete Bea's account. They have no private drawings or folders. This can't be undone. Their 1 Team drawing stays with the team.",
    ),
  ).toBeTruthy()
})

test("a failed counts fetch explains itself and keeps confirm gated", async () => {
  vi.mocked(getUserContentCounts).mockRejectedValue(new Error("boom"))
  renderSection()

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /delete user/i }))

  expect(
    await screen.findByText(/Couldn't load Bea's content counts/),
  ).toBeTruthy()
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "bea@example.com" },
  })
  expect(
    (screen.getByRole("button", { name: "Delete user" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
})

test("the confirm stays gated while the counts are still loading", async () => {
  vi.mocked(getUserContentCounts).mockReturnValue(new Promise(() => {}))
  renderSection()

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /delete user/i }))
  await flush()

  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "bea@example.com" },
  })
  expect(
    (screen.getByRole("button", { name: "Delete user" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
})

test("confirming deletes the user and the refreshed list drops them", async () => {
  vi.mocked(getUserContentCounts).mockResolvedValue({
    drawings: 0,
    folders: 0,
    teamDrawings: 0,
  })
  vi.mocked(deleteUser).mockResolvedValue(undefined)
  renderSection()
  // Installed after renderSection (which pins getAllUsers to the seed list):
  // the list server fn mirrors reality — Bea is gone only once the delete
  // has landed — so the success invalidation's refetch drops her row.
  vi.mocked(getAllUsers).mockImplementation(async () =>
    vi.mocked(deleteUser).mock.calls.length > 0
      ? members.filter((member) => member.id !== "user-bea")
      : members,
  )

  openRowMenu("Bea")
  fireEvent.click(screen.getByRole("menuitem", { name: /delete user/i }))
  await flush()
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "bea@example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Delete user" }))
  await flush()

  expect(deleteUser).toHaveBeenCalledWith({ data: "user-bea" })
  await waitFor(() => expect(screen.queryByText("bea@example.com")).toBeNull())
  expect(screen.queryByRole("alertdialog")).toBeNull()
})

test("every row shows a role select reflecting the current role", () => {
  renderSection()
  expect(roleSelect("ada").textContent).toBe("Admin")
  expect(roleSelect("Bea").textContent).toBe("Member")
  expect(roleSelect("Cy").textContent).toBe("Member")
})

test("the sole admin's select is disabled with an explanation", async () => {
  renderSection()
  const select = roleSelect("ada")
  expect(select.disabled).toBe(true)

  // The tooltip listens on the focusable wrapper around the disabled trigger.
  fireEvent.focus(select.parentElement as HTMLElement)
  await waitFor(() =>
    expect(
      screen.getAllByText("The last admin can't be demoted.").length,
    ).toBeGreaterThan(0),
  )
})

test("an admin can be demoted while another admin remains", async () => {
  // A never-settling call proves the flip happens before the server answers.
  vi.mocked(setUserRole).mockReturnValue(new Promise(() => {}))
  renderSection({ users: twoAdmins })
  const select = roleSelect("Bea")
  expect(select.disabled).toBe(false)

  chooseRole("Bea", "Member")
  await waitFor(() => expect(roleSelect("Bea").textContent).toBe("Member"))
  // react-query passes a context object as a second argument.
  await waitFor(() =>
    expect(vi.mocked(setUserRole).mock.calls[0]?.[0]).toEqual({
      data: { userId: "user-bea", role: "user" },
    }),
  )
})

test("promoting a member applies optimistically", async () => {
  vi.mocked(setUserRole).mockReturnValue(new Promise(() => {}))
  renderSection()
  chooseRole("Bea", "Admin")
  await waitFor(() => expect(roleSelect("Bea").textContent).toBe("Admin"))
  await waitFor(() =>
    expect(vi.mocked(setUserRole).mock.calls[0]?.[0]).toEqual({
      data: { userId: "user-bea", role: "admin" },
    }),
  )
})

test("a rejected role change rolls back with an error toast", async () => {
  vi.mocked(setUserRole).mockRejectedValue(new Error("boom"))
  renderSection()

  chooseRole("Bea", "Admin")

  await waitFor(() =>
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't change role"),
  )
  await waitFor(() => expect(roleSelect("Bea").textContent).toBe("Member"))
})

test("demoting yourself asks for confirmation before anything is sent", () => {
  renderSection({ users: twoAdmins })
  chooseRole("ada", "Member")

  expect(screen.getByText("Leave the admin role?")).not.toBeNull()
  expect(setUserRole).not.toHaveBeenCalled()
  // The select stays on Admin until the demotion is confirmed. The open
  // modal aria-hides the page behind it, hence the hidden query.
  const select = screen.getByRole("combobox", {
    name: "Role for ada",
    hidden: true,
  })
  expect(select.textContent).toBe("Admin")
})

test("confirming a self-demote applies it and leaves the admin area", async () => {
  renderSection({ users: twoAdmins })
  chooseRole("ada", "Member")
  fireEvent.click(screen.getByRole("button", { name: "Demote me" }))

  await waitFor(() =>
    expect(setUserRole).toHaveBeenCalledWith({
      data: { userId: "user-ada", role: "user" },
    }),
  )
  // The members page is admin-only, so a confirmed self-demote lands on the
  // Account page and re-runs the loaders that gate the admin chrome.
  await waitFor(() =>
    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings" }),
  )
  await waitFor(() => expect(invalidateMock).toHaveBeenCalled())
})

test("cancelling a self-demote changes nothing", async () => {
  renderSection({ users: twoAdmins })
  chooseRole("ada", "Member")
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

  await waitFor(() =>
    expect(screen.queryByText("Leave the admin role?")).toBeNull(),
  )
  expect(setUserRole).not.toHaveBeenCalled()
  expect(roleSelect("ada").textContent).toBe("Admin")
})

test("a failed self-demote keeps the dialog open with an error toast", async () => {
  vi.mocked(setUserRole).mockRejectedValue(new Error("boom"))
  renderSection({ users: twoAdmins })
  chooseRole("ada", "Member")
  fireEvent.click(screen.getByRole("button", { name: "Demote me" }))

  await waitFor(() =>
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't change role"),
  )
  expect(screen.getByText("Leave the admin role?")).not.toBeNull()
  expect(navigateMock).not.toHaveBeenCalled()
})

test("the skeleton appears only after the grace period", () => {
  vi.useFakeTimers()
  vi.mocked(getAllUsers).mockReturnValue(new Promise(() => {}))
  const { container } = renderSection({ seed: false })

  // Within the grace period nothing renders — no skeleton flash.
  expect(container.querySelector("[data-slot='skeleton']")).toBeNull()

  act(() => vi.advanceTimersByTime(150))
  expect(container.querySelector("[data-slot='skeleton']")).not.toBeNull()
})
