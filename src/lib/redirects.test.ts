import { expect, test } from "vitest"
import { resolveRedirect } from "./redirects"

test("a same-origin relative path is honored as-is", () => {
  expect(resolveRedirect("/draw/abc123?tab=export")).toBe(
    "/draw/abc123?tab=export",
  )
})

test("no redirect param falls back to /draw", () => {
  expect(resolveRedirect(undefined)).toBe("/draw")
  expect(resolveRedirect("")).toBe("/draw")
})

test("absolute URLs fall back to /draw", () => {
  expect(resolveRedirect("https://evil.example/draw")).toBe("/draw")
  expect(resolveRedirect("http://evil.example")).toBe("/draw")
})

test("protocol-relative and backslash paths fall back to /draw", () => {
  expect(resolveRedirect("//evil.example/draw")).toBe("/draw")
  expect(resolveRedirect("/\\evil.example")).toBe("/draw")
  expect(resolveRedirect("/\\/evil.example")).toBe("/draw")
  expect(resolveRedirect("///evil.example")).toBe("/draw")
})

test("control-character smuggling falls back to /draw", () => {
  // Browsers strip tab/CR/LF from URLs, so "/\t/evil" navigates to "//evil".
  expect(resolveRedirect("/\t/evil.example")).toBe("/draw")
  expect(resolveRedirect("/\n/evil.example")).toBe("/draw")
  expect(resolveRedirect("/%09/x")).toBe("/%09/x") // percent-encoded is inert
})

test("dot segments that collapse into a protocol-relative path fall back to /draw", () => {
  // The URL parser removes "." and ".." after it picks the host, so these
  // normalize to the pathname "//evil.example".
  expect(resolveRedirect("/.//evil.example")).toBe("/draw")
  expect(resolveRedirect("/a/..//evil.example")).toBe("/draw")
  expect(resolveRedirect("/%2e//evil.example")).toBe("/draw")
})
