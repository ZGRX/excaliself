// @vitest-environment node
import { expect, test, vi } from "vitest"

vi.mock("@/env", () => ({ env: { PREVIEW_MODE: false } }))

const { mayJoinWithSso } = await import("./sso")

const domains = ["acme.com"]

test("an allowed domain joins through Microsoft or OIDC", () => {
  expect(mayJoinWithSso("Anna@Acme.com", "microsoft", {}, domains)).toBe(true)
  expect(mayJoinWithSso("anna@acme.com", "oidc", {}, domains)).toBe(true)
})

test("any other domain needs an invite", () => {
  expect(mayJoinWithSso("bob@gmail.com", "oidc", {}, domains)).toBe(false)
  expect(mayJoinWithSso("bob@acme.com.evil", "oidc", {}, domains)).toBe(false)
  expect(mayJoinWithSso("anna@acme.com", "oidc", {}, [])).toBe(false)
})

test("Google needs a Workspace account of that domain", () => {
  const workspace = { hd: "acme.com" }
  expect(mayJoinWithSso("anna@acme.com", "google", workspace, domains)).toBe(
    true,
  )
  // A personal Google account registered with a work address has no hd.
  expect(mayJoinWithSso("anna@acme.com", "google", {}, domains)).toBe(false)
  expect(
    mayJoinWithSso("anna@acme.com", "google", { hd: "other.com" }, domains),
  ).toBe(false)
})
