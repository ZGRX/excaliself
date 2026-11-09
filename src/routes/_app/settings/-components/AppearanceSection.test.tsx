import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { AppearanceSection } from "./AppearanceSection"

// Auto-cleanup needs vitest globals, which this repo leaves off.
afterEach(cleanup)
afterEach(() => {
  document.documentElement.classList.remove("dark")
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function group(name: string) {
  return within(screen.getByRole("radiogroup", { name }))
}

function checked(groupName: string, name: string) {
  return group(groupName)
    .getByRole("radio", { name })
    .getAttribute("aria-checked")
}

test("Theme offers Light, Dark and System — a user who never chose has Light selected", () => {
  render(<AppearanceSection />)
  expect(checked("Theme", "Light")).toBe("true")
  expect(checked("Theme", "Dark")).toBe("false")
  expect(checked("Theme", "System")).toBe("false")
})

test("a stored dark choice renders with Dark selected", () => {
  window.localStorage.setItem("theme", "dark")
  render(<AppearanceSection />)
  expect(checked("Theme", "Dark")).toBe("true")
})

test("a stored System choice renders with System selected", () => {
  window.localStorage.setItem("theme", "system")
  render(<AppearanceSection />)
  expect(checked("Theme", "System")).toBe("true")
  expect(checked("Theme", "Light")).toBe("false")
})

test("picking System persists it and applies the OS theme", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
  render(<AppearanceSection />)
  fireEvent.click(group("Theme").getByRole("radio", { name: "System" }))
  expect(window.localStorage.getItem("theme")).toBe("system")
  expect(document.documentElement.classList.contains("dark")).toBe(true)
  expect(checked("Theme", "System")).toBe("true")
  expect(checked("Theme", "Light")).toBe("false")
})

test("picking Dark applies and persists immediately, and the control follows", () => {
  render(<AppearanceSection />)
  fireEvent.click(group("Theme").getByRole("radio", { name: "Dark" }))
  expect(document.documentElement.classList.contains("dark")).toBe(true)
  expect(window.localStorage.getItem("theme")).toBe("dark")
  expect(checked("Theme", "Dark")).toBe("true")
  expect(checked("Theme", "Light")).toBe("false")

  fireEvent.click(group("Theme").getByRole("radio", { name: "Light" }))
  expect(document.documentElement.classList.contains("dark")).toBe(false)
  expect(window.localStorage.getItem("theme")).toBe("light")
  expect(checked("Theme", "Light")).toBe("true")
})

test("Canvas offers Match app, Light and Dark — Match app selected by default", () => {
  render(<AppearanceSection />)
  expect(checked("Canvas", "Match app")).toBe("true")
  expect(checked("Canvas", "Light")).toBe("false")
  expect(checked("Canvas", "Dark")).toBe("false")
})

test("a stored canvas override renders selected; junk falls back to Match app", () => {
  window.localStorage.setItem("canvas-theme", "dark")
  render(<AppearanceSection />)
  expect(checked("Canvas", "Dark")).toBe("true")
  cleanup()

  window.localStorage.setItem("canvas-theme", "system")
  render(<AppearanceSection />)
  expect(checked("Canvas", "Match app")).toBe("true")
})

test("picking a canvas theme persists without touching the app theme", () => {
  render(<AppearanceSection />)
  fireEvent.click(group("Canvas").getByRole("radio", { name: "Dark" }))
  expect(window.localStorage.getItem("canvas-theme")).toBe("dark")
  expect(checked("Canvas", "Dark")).toBe("true")
  expect(document.documentElement.classList.contains("dark")).toBe(false)
  expect(checked("Theme", "Light")).toBe("true")

  fireEvent.click(group("Canvas").getByRole("radio", { name: "Match app" }))
  expect(window.localStorage.getItem("canvas-theme")).toBe("match")
  expect(checked("Canvas", "Match app")).toBe("true")
})

test("changing the app theme leaves the canvas selection alone", () => {
  render(<AppearanceSection />)
  fireEvent.click(group("Canvas").getByRole("radio", { name: "Light" }))
  fireEvent.click(group("Theme").getByRole("radio", { name: "Dark" }))
  expect(checked("Canvas", "Light")).toBe("true")
  expect(window.localStorage.getItem("canvas-theme")).toBe("light")
})
