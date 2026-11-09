import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { setCanvasThemePreference, setThemePreference } from "@/lib/theme"
import {
  useApplyTheme,
  useCanvasTheme,
  useCanvasThemePreference,
  useStoredTheme,
  useThemePreference,
} from "./use-theme"

afterEach(cleanup)
afterEach(() => {
  document.documentElement.classList.remove("dark")
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function appliedDark() {
  return document.documentElement.classList.contains("dark")
}

// A stand-in for the OS light/dark setting: jsdom has no matchMedia.
function stubSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }
  const matchMedia = vi.fn(() => query)
  vi.stubGlobal("matchMedia", matchMedia)
  return {
    matchMedia,
    listeners,
    change(nextDark: boolean) {
      query.matches = nextDark
      for (const listener of [...listeners]) listener()
    },
  }
}

test("useStoredTheme applies the stored device choice on mount", () => {
  window.localStorage.setItem("theme", "dark")
  renderHook(useStoredTheme)
  expect(appliedDark()).toBe(true)
})

test("useStoredTheme defaults to Light when nothing (or junk) is stored", () => {
  window.localStorage.setItem("theme", "banana")
  document.documentElement.classList.add("dark")
  renderHook(useStoredTheme)
  expect(appliedDark()).toBe(false)
})

test("useStoredTheme with System follows the OS live, and stops on unmount", () => {
  const os = stubSystemTheme(true)
  window.localStorage.setItem("theme", "system")
  const { unmount } = renderHook(useStoredTheme)
  expect(appliedDark()).toBe(true)

  act(() => os.change(false))
  expect(appliedDark()).toBe(false)
  act(() => os.change(true))
  expect(appliedDark()).toBe(true)

  unmount()
  expect(os.listeners.size).toBe(0)
})

test("useStoredTheme listens to the OS only while System is chosen", () => {
  const os = stubSystemTheme(true)
  renderHook(useStoredTheme)
  expect(appliedDark()).toBe(false)
  expect(os.matchMedia).not.toHaveBeenCalled()

  act(() => setThemePreference("system"))
  expect(appliedDark()).toBe(true)
  expect(os.listeners.size).toBe(1)

  act(() => setThemePreference("light"))
  expect(appliedDark()).toBe(false)
  expect(os.listeners.size).toBe(0)
  act(() => os.change(true))
  expect(appliedDark()).toBe(false)
})

test("useApplyTheme pins the document to the given theme", () => {
  window.localStorage.setItem("theme", "dark")
  document.documentElement.classList.add("dark")
  renderHook(useApplyTheme, { initialProps: "light" as const })
  expect(appliedDark()).toBe(false)
})

test("useCanvasTheme follows the applied app theme, live", () => {
  const { result } = renderHook(useCanvasTheme)
  expect(result.current).toBe("light")

  act(() => setThemePreference("dark"))
  expect(result.current).toBe("dark")

  act(() => setThemePreference("light"))
  expect(result.current).toBe("light")
})

test("useCanvasTheme: Match app follows an OS change under System, live", () => {
  const os = stubSystemTheme(false)
  window.localStorage.setItem("theme", "system")
  renderHook(useStoredTheme)
  const { result } = renderHook(useCanvasTheme)
  expect(result.current).toBe("light")

  act(() => os.change(true))
  expect(result.current).toBe("dark")
})

test("useCanvasTheme: a pinned canvas theme wins over the app theme, live", () => {
  const { result } = renderHook(useCanvasTheme)

  act(() => setCanvasThemePreference("dark"))
  expect(result.current).toBe("dark")

  act(() => setThemePreference("dark"))
  act(() => setCanvasThemePreference("light"))
  expect(result.current).toBe("light")
})

test("useCanvasTheme: Match app returns the canvas to following the app theme", () => {
  window.localStorage.setItem("theme", "dark")
  renderHook(useStoredTheme)
  const { result } = renderHook(useCanvasTheme)

  act(() => setCanvasThemePreference("light"))
  expect(result.current).toBe("light")

  act(() => setCanvasThemePreference("match"))
  expect(result.current).toBe("dark")
})

test("useCanvasThemePreference tracks setCanvasThemePreference reactively", () => {
  const { result } = renderHook(useCanvasThemePreference)
  expect(result.current).toBe("match")

  act(() => setCanvasThemePreference("dark"))
  expect(result.current).toBe("dark")
  expect(window.localStorage.getItem("canvas-theme")).toBe("dark")
})

test("useThemePreference tracks setThemePreference reactively — the round-trip", () => {
  const { result } = renderHook(useThemePreference)
  expect(result.current).toBe("light")

  act(() => setThemePreference("dark"))
  expect(result.current).toBe("dark")
  expect(window.localStorage.getItem("theme")).toBe("dark")
  expect(appliedDark()).toBe(true)

  act(() => setThemePreference("light"))
  expect(result.current).toBe("light")
  expect(appliedDark()).toBe(false)

  act(() => setThemePreference("system"))
  expect(result.current).toBe("system")
  expect(window.localStorage.getItem("theme")).toBe("system")
})
