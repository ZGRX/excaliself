import { useEffect, useSyncExternalStore } from "react"
import {
  applyResolvedTheme,
  type CanvasThemePreference,
  DEFAULT_CANVAS_THEME,
  DEFAULT_THEME,
  readResolvedTheme,
  readStoredCanvasThemePreference,
  readStoredThemePreference,
  readSystemTheme,
  resolveCanvasTheme,
  resolveThemeChoice,
  subscribeToSystemTheme,
  subscribeToTheme,
  type ThemeChoice,
  type ThemePreference,
} from "@/lib/theme"

// Pins the document to a fixed theme while the caller is mounted — the auth
// pages use it to stay light regardless of the stored choice.
export function useApplyTheme(theme: ThemePreference) {
  useEffect(() => {
    applyResolvedTheme(theme)
  }, [theme])
}

/**
 * The app shell's theme driver: applies the stored device choice on mount
 * (the pre-paint bootstrap already did on a fresh load; this covers SPA
 * navigation out of a forced-light auth page). Later changes go through
 * setThemePreference, which applies as it saves. While System is chosen it
 * also follows the OS live — the only time the OS is listened to; the
 * listener goes away with the shell, so forced-light pages stay light.
 */
export function useStoredTheme() {
  const choice = useThemePreference()
  useEffect(() => {
    // Storage first: while hydrating, `choice` still holds the server
    // default, and applying that would flash Light over a stored Dark.
    const current = readStoredThemePreference() ?? choice
    applyResolvedTheme(resolveThemeChoice(current))
    if (current !== "system") return
    return subscribeToSystemTheme(() => applyResolvedTheme(readSystemTheme()))
  }, [choice])
}

// The stored choice as a reactive value — the Appearance control renders
// from this so a click updates its checked state through the store.
export function useThemePreference(): ThemeChoice {
  return useSyncExternalStore(
    subscribeToTheme,
    () => readStoredThemePreference() ?? DEFAULT_THEME,
    () => DEFAULT_THEME,
  )
}

// The applied theme as a value — for chrome that needs it as data (the
// Toaster) rather than through CSS variables.
export function useResolvedTheme(): ThemePreference {
  return useSyncExternalStore(
    subscribeToTheme,
    readResolvedTheme,
    () => "light",
  )
}

// The stored canvas override as a reactive value — the Canvas control in
// Settings renders its checked state from this.
export function useCanvasThemePreference(): CanvasThemePreference {
  return useSyncExternalStore(
    subscribeToTheme,
    readStoredCanvasThemePreference,
    () => DEFAULT_CANVAS_THEME,
  )
}

// The drawing canvas's theme feed: switching the app theme or the canvas
// override in Settings re-renders any open drawing to match, live.
export function useCanvasTheme(): ThemePreference {
  return resolveCanvasTheme(useResolvedTheme(), useCanvasThemePreference())
}
