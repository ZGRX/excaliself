import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { SignInOptions } from "@/features/auth/server"

const navigate = vi.fn()
let search: { redirect?: string; error?: string } = {}
let signInOptions: SignInOptions

const noOptions: SignInOptions = {
  previewMode: false,
  ssoProviders: [],
  ssoAllowedDomains: [],
}

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    useLoaderData: () => signInOptions,
  }),
  useNavigate: () => navigate,
  useSearch: () => search,
}))

const signInEmail = vi.fn()
const signInSocial = vi.fn()

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      social: (...args: unknown[]) => signInSocial(...args),
    },
  },
}))

vi.mock("@/middleware/setup", () => ({
  setupMiddleware: {},
}))

vi.mock("@/features/auth/server", () => ({
  getSignInOptions: vi.fn(),
}))

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)

beforeEach(() => {
  navigate.mockClear()
  signInEmail.mockClear()
  signInSocial.mockReset()
  search = {}
  signInOptions = noOptions
})

async function renderLogin() {
  const { Route } = await import("./login")
  const LoginPage = (
    Route as unknown as { options: { component: React.ComponentType } }
  ).options.component
  return render(<LoginPage />)
}

async function signIn() {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "user@example.com" },
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "hunter22" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  await screen.findByRole("button", { name: "Sign in" })
}

test("login is email + password + Sign in — nothing else", async () => {
  await renderLogin()
  expect(screen.getByLabelText(/email/i)).toBeDefined()
  expect(screen.getByLabelText(/password/i)).toBeDefined()
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined()
  // No remember-me, self-serve reset, or SSO unless configured.
  expect(screen.queryByRole("checkbox")).toBeNull()
  expect(screen.queryByText(/remember me/i)).toBeNull()
  expect(screen.queryByRole("link")).toBeNull()
})

test("microcopy explains invite-only registration and admin-managed resets", async () => {
  await renderLogin()
  expect(
    screen.getByText("Registration is invite-only on this instance"),
  ).toBeDefined()
  expect(
    screen.getByText("Forgot your password? Ask your admin to reset it."),
  ).toBeDefined()
})

test("signing in without a redirect param lands on /draw", async () => {
  signInEmail.mockResolvedValueOnce({ error: null })
  await renderLogin()
  await signIn()
  expect(navigate).toHaveBeenCalledWith({ href: "/draw" })
})

test("signing in with a ?redirect param lands on that path", async () => {
  search = { redirect: "/draw/abc123?tab=export" }
  signInEmail.mockResolvedValueOnce({ error: null })
  await renderLogin()
  await signIn()
  expect(navigate).toHaveBeenCalledWith({ href: "/draw/abc123?tab=export" })
})

test("a cross-origin ?redirect is ignored in favor of /draw", async () => {
  search = { redirect: "https://evil.example/phish" }
  signInEmail.mockResolvedValueOnce({ error: null })
  await renderLogin()
  await signIn()
  expect(navigate).toHaveBeenCalledWith({ href: "/draw" })
})

test("a PR preview offers one-click sign-in links", async () => {
  signInOptions = { ...noOptions, previewMode: true }
  await renderLogin()
  expect(
    screen
      .getByRole("link", { name: "Sign in as a new test account" })
      .getAttribute("href"),
  ).toBe("/preview/login?account=new")
  expect(
    screen
      .getByRole("link", { name: "Sign in as admin@example.com" })
      .getAttribute("href"),
  ).toBe("/preview/login")
})

test("the preview links keep the ?redirect param", async () => {
  signInOptions = { ...noOptions, previewMode: true }
  search = { redirect: "/draw/abc123" }
  await renderLogin()
  expect(
    screen
      .getByRole("link", { name: "Sign in as a new test account" })
      .getAttribute("href"),
  ).toBe("/preview/login?account=new&redirect=%2Fdraw%2Fabc123")
})

test("configured SSO providers start sign-in and keep the ?redirect param", async () => {
  signInOptions = {
    ...noOptions,
    ssoProviders: [
      { id: "google", name: "Google" },
      { id: "oidc", name: "Authentik" },
    ],
  }
  search = { redirect: "/draw/abc123" }
  signInSocial.mockResolvedValueOnce({ error: null })
  await renderLogin()
  expect(screen.getByRole("button", { name: "Continue with Google" }))
  fireEvent.click(
    screen.getByRole("button", { name: "Continue with Authentik" }),
  )
  expect(signInSocial).toHaveBeenCalledWith({
    provider: "oidc",
    callbackURL: "/draw/abc123",
    errorCallbackURL: "/login?redirect=%2Fdraw%2Fabc123",
  })
})

test("allowed SSO domains replace the invite-only note", async () => {
  signInOptions = {
    ...noOptions,
    ssoProviders: [{ id: "google", name: "Google" }],
    ssoAllowedDomains: ["acme.com"],
  }
  await renderLogin()
  expect(
    screen.getByText(
      "New here? Continue with your acme.com account, or ask for an invite.",
    ),
  ).toBeDefined()
})

test("a refused SSO sign-in explains itself", async () => {
  search = { error: "signup_not_allowed" }
  await renderLogin()
  expect(screen.getByRole("alert").textContent).toBe(
    "There is no account for this email. Ask your admin for an invite.",
  )
})
