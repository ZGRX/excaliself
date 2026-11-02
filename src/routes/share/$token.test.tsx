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
import type { ShareVisit } from "@/features/shares/server"
import { resolveShareToken } from "@/features/shares/server"
import type { ShareResolution } from "@/features/shares/store"
import { isOpenAsTeam } from "@/features/spaces/server"

const TOKEN = "a-share-token"
const invalidate = vi.fn()
const navigate = vi.fn()
let loaderData: ShareVisit
let search: { full?: boolean } = {}

const redirect = vi.fn((opts: unknown) => ({ isRedirect: true, opts }))

vi.mock("@tanstack/react-router", () => ({
  redirect,
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    useLoaderData: () => loaderData,
    useSearch: () => search,
    // The canvas joins the room on the token, so the page reads the param.
    useParams: () => ({ token: TOKEN }),
  }),
  useRouter: () => ({ invalidate }),
  useNavigate: () => navigate,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("@/features/shares/server", () => ({ resolveShareToken: vi.fn() }))
vi.mock("@/features/spaces/server", () => ({ isOpenAsTeam: vi.fn() }))
vi.mock("@/features/auth/server", () => ({
  getSignInOptions: vi.fn().mockResolvedValue({ ssoProviders: [] }),
}))

// The real one drags Excalidraw into jsdom; this slice is about the states
// around the canvas, not the canvas. The buttons stand in for the room
// closing the socket at its participant cap, on a damaged scene, or on a
// dead link.
vi.mock("./-components/SharedCanvas", () => ({
  default: ({
    token,
    onRoomFull,
    onSceneUnreadable,
    onLinkDead,
  }: {
    token: string
    onRoomFull: () => void
    onSceneUnreadable: () => void
    onLinkDead: () => void
  }) => (
    <div data-testid="shared-canvas" data-token={token}>
      <button type="button" onClick={onLinkDead}>
        Kill the link
      </button>
      <button type="button" onClick={onRoomFull}>
        Refuse the join
      </button>
      <button type="button" onClick={onSceneUnreadable}>
        Refuse the scene
      </button>
    </div>
  ),
}))

const signInEmail = vi.fn()
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args) },
  },
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const OK: ShareResolution = {
  status: "ok",
  audience: "anyone",
  drawing: { id: "d1", name: "Roadmap Q3", data: "{}" },
  files: [],
}
const SIGNIN: ShareResolution = { status: "signin", drawingName: "Roadmap Q3" }
const DEAD: ShareResolution = { status: "dead" }
const THROTTLED: ShareVisit = { status: "throttled" }

async function renderShare(resolution: ShareVisit) {
  loaderData = resolution
  const { Route } = await import("./$token")
  const SharePage = (
    Route as unknown as { options: { component: React.ComponentType } }
  ).options.component
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SharePage />
    </QueryClientProvider>,
  )
}

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  search = {}
})

test("a dead token gets the generic page — no drawing name, no sign-in gate", async () => {
  await renderShare(DEAD)
  expect(
    screen.getByRole("heading", { name: "This link is no longer active" }),
  ).toBeDefined()
  expect(
    screen.getByText(
      "It may have been turned off or replaced by the drawing's owner.",
    ),
  ).toBeDefined()
  // Same anchor-as-button pattern the dead invite page uses.
  const goHome = screen.getByRole("button", { name: "Go to Excaliself" })
  expect(goHome.getAttribute("href")).toBe("/")
  // Nothing leaks about whether a drawing exists, and a dead token never
  // offers the gate — signing in could never revive it.
  expect(screen.queryByLabelText(/email/i)).toBeNull()
  expect(screen.queryByText(/Roadmap Q3/)).toBeNull()
})

test("the dead page is branded — mark, illustration panel, always light", async () => {
  window.localStorage.setItem("theme", "dark")
  document.documentElement.classList.add("dark")
  const { container } = await renderShare(DEAD)
  expect(container.querySelector('svg[viewBox="0 0 22 25"]')).not.toBeNull()
  expect(container.querySelector("[data-auth-panel]")).not.toBeNull()
  expect(document.documentElement.classList.contains("dark")).toBe(false)
  window.localStorage.clear()
})

test("a members-only link without a session gets the sign-in gate in place", async () => {
  await renderShare(SIGNIN)
  expect(
    screen.getByRole("heading", { name: "Sign in to open this drawing" }),
  ).toBeDefined()
  expect(screen.getByText(/Roadmap Q3/)).toBeDefined()
  expect(screen.getByLabelText(/email/i)).toBeDefined()
  expect(screen.getByLabelText(/password/i)).toBeDefined()
  expect(
    screen.getByText("You'll return to the drawing right after signing in."),
  ).toBeDefined()
  // The visitor stays on /share/<token> — no bounce through /login.
  expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull()
})

test("signing in on the gate revalidates in place instead of navigating away", async () => {
  signInEmail.mockResolvedValueOnce({ error: null })
  await renderShare(SIGNIN)
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "member@example.com" },
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "hunter22" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  // The loader re-runs with the fresh session cookie and returns the canvas.
  await waitFor(() => expect(invalidate).toHaveBeenCalled())
})

test("the gate stays pending until the revalidation it kicked off finishes", async () => {
  signInEmail.mockResolvedValueOnce({ error: null })
  invalidate.mockReturnValueOnce(new Promise(() => {}))
  await renderShare(SIGNIN)
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "member@example.com" },
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "hunter22" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  // Going idle here would offer a resubmit over a page about to be replaced.
  expect(
    await screen.findByRole("button", { name: "Signing in..." }),
  ).toBeDefined()
})

test("bad credentials on the gate leave the visitor on the gate", async () => {
  signInEmail.mockResolvedValueOnce({ error: { message: "Invalid password" } })
  await renderShare(SIGNIN)
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "member@example.com" },
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "wrong" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  await waitFor(() => expect(signInEmail).toHaveBeenCalled())
  expect(invalidate).not.toHaveBeenCalled()
  expect(
    screen.getByRole("heading", { name: "Sign in to open this drawing" }),
  ).toBeDefined()
})

test("a live link renders the canvas", async () => {
  await renderShare(OK)
  expect(await screen.findByTestId("shared-canvas")).toBeDefined()
})

test("the canvas gets the token — it is what the room socket dials", async () => {
  await renderShare(OK)
  const canvas = await screen.findByTestId("shared-canvas")
  expect(canvas.getAttribute("data-token")).toBe(TOKEN)
})

test("the ?full flag renders the room-full state on a live link", async () => {
  search = { full: true }
  await renderShare(OK)
  expect(
    screen.getByRole("heading", { name: "This drawing is full" }),
  ).toBeDefined()
  expect(screen.queryByTestId("shared-canvas")).toBeNull()
})

test("the ?full flag can't turn a dead token into any other page", async () => {
  search = { full: true }
  await renderShare(DEAD)
  expect(
    screen.getByRole("heading", { name: "This link is no longer active" }),
  ).toBeDefined()
})

test("retrying drops the flag that put the visitor on the full page", async () => {
  search = { full: true }
  await renderShare(OK)
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  // Revalidating alone would land right back here — the flag has to go.
  expect(navigate).toHaveBeenCalledWith({ search: {}, replace: true })
})

test("every spelling of the flag the URL can carry turns the state on", async () => {
  const { Route } = await import("./$token")
  const validateSearch = (
    Route as unknown as {
      options: {
        validateSearch: (s: Record<string, unknown>) => { full?: boolean }
      }
    }
  ).options.validateSearch
  // ?full=1 is what a reviewer types; ?full=true is what the router writes
  // back out for { full: true }; ?full is the bare flag.
  expect(validateSearch({ full: "1" })).toEqual({ full: true })
  expect(validateSearch({ full: "true" })).toEqual({ full: true })
  expect(validateSearch({ full: "" })).toEqual({ full: true })
  expect(validateSearch({})).toEqual({})
})

test("a refused join sends the visitor to the room-full state", async () => {
  await renderShare(OK)
  fireEvent.click(
    await screen.findByRole("button", { name: "Refuse the join" }),
  )
  // Recorded in the URL rather than component state, so the retry is a plain
  // navigation back to the same page.
  expect(navigate).toHaveBeenCalledWith({
    search: { full: true },
    replace: true,
  })
})

test("a damaged scene replaces the canvas with a page that says so", async () => {
  await renderShare(OK)
  fireEvent.click(
    await screen.findByRole("button", { name: "Refuse the scene" }),
  )
  expect(
    screen.getByRole("heading", { name: "This drawing can't be opened" }),
  ).toBeDefined()
  expect(screen.queryByTestId("shared-canvas")).toBeNull()
})

test("a throttled visit gets its own retryable state, not the dead link", async () => {
  await renderShare(THROTTLED)
  expect(
    screen.getByRole("heading", { name: "Too many attempts" }),
  ).toBeDefined()
  expect(screen.queryByTestId("shared-canvas")).toBeNull()
  // The token was never looked up, so the page can't say anything about it.
  expect(screen.queryByText(/Roadmap Q3/)).toBeNull()
  expect(screen.queryByLabelText(/email/i)).toBeNull()
})

test("retrying a throttled visit re-runs the loader in place", async () => {
  await renderShare(THROTTLED)
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(invalidate).toHaveBeenCalled()
})

test("the ?full flag can't turn a throttled visit into the room-full state", async () => {
  search = { full: true }
  await renderShare(THROTTLED)
  expect(
    screen.getByRole("heading", { name: "Too many attempts" }),
  ).toBeDefined()
})

// A members link dies when its drawing moves to Team; members in its Room
// can open it by id from then on.
test("a member whose link died with a move to Team rejoins the drawing by id", async () => {
  vi.mocked(isOpenAsTeam).mockResolvedValue(true)
  await renderShare({ ...OK, audience: "members" })
  fireEvent.click(await screen.findByRole("button", { name: "Kill the link" }))

  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/draw/$id",
      params: { id: "d1" },
    }),
  )
  expect(invalidate).not.toHaveBeenCalled()
})

test("a members link that died any other way goes back to the loader", async () => {
  vi.mocked(isOpenAsTeam).mockResolvedValue(false)
  await renderShare({ ...OK, audience: "members" })
  fireEvent.click(await screen.findByRole("button", { name: "Kill the link" }))

  await waitFor(() => expect(invalidate).toHaveBeenCalled())
  expect(navigate).not.toHaveBeenCalled()
})

test("a guest whose link died never asks about Team", async () => {
  await renderShare(OK)
  fireEvent.click(await screen.findByRole("button", { name: "Kill the link" }))

  await waitFor(() => expect(invalidate).toHaveBeenCalled())
  expect(isOpenAsTeam).not.toHaveBeenCalled()
})

test("a members link a move to Team dropped redirects to the drawing", async () => {
  vi.mocked(resolveShareToken).mockResolvedValue({
    status: "moved",
    drawingId: "d1",
  })
  const { Route } = await import("./$token")
  const { loader } = (
    Route as unknown as {
      options: { loader: (ctx: { params: { token: string } }) => unknown }
    }
  ).options

  await expect(loader({ params: { token: TOKEN } })).rejects.toMatchObject({
    isRedirect: true,
  })
  expect(redirect).toHaveBeenCalledWith({
    to: "/draw/$id",
    params: { id: "d1" },
    replace: true,
  })
})
