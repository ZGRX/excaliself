export type ThemePreference = "light" | "dark"

// What the user picks in Settings: an explicit theme, or "system" to follow
// the OS light/dark setting (live). ThemePreference stays the resolved,
// applied theme.
export type ThemeChoice = ThemePreference | "system"

// The device-scoped theme choice. localStorage is the source of truth —
// deliberately not synced to the account (owner decision): each browser
// keeps its own choice, and it survives sign-out. The key predates this
// module (next-themes convention), so older stored values keep working,
// including a legacy "system"; anything else reads as unset.
export const THEME_STORAGE_KEY = "theme"

// Light unless the user explicitly chose Dark or System in Settings. The OS
// preference is consulted only when System is chosen.
export const DEFAULT_THEME: ThemeChoice = "light"

// The media query behind the System choice.
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)"

// Browser-chrome tints for the theme-color meta: the --background tokens
// from styles.css (the Etched chrome, light / dark).
export const THEME_COLORS: Record<ThemePreference, string> = {
  light: "#ebebee",
  dark: "#131316",
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark"
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || isThemePreference(value)
}

// The OS light/dark setting. matchMedia can be missing (old browsers,
// jsdom); that reads as Light, the app default.
export function readSystemTheme(): ThemePreference {
  try {
    return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light"
  } catch {
    return "light"
  }
}

// A choice → the theme to apply. Only System reads the OS.
export function resolveThemeChoice(choice: ThemeChoice): ThemePreference {
  return choice === "system" ? readSystemTheme() : choice
}

/**
 * Calls `listener` whenever the OS switches between light and dark. Only
 * the app shell subscribes, and only while System is chosen, so the OS
 * stays unconsulted for Light and Dark.
 */
export function subscribeToSystemTheme(listener: () => void): () => void {
  let query: MediaQueryList
  try {
    query = window.matchMedia(SYSTEM_DARK_QUERY)
  } catch {
    return () => {}
  }
  query.addEventListener("change", listener)
  return () => query.removeEventListener("change", listener)
}

// The canvas override: "match" follows the app theme; "light"/"dark" pin
// the canvas regardless of it. Device-scoped like the app theme — stored
// beside it, never synced to the account, survives sign-out.
export type CanvasThemePreference = "match" | ThemePreference

export const CANVAS_THEME_STORAGE_KEY = "canvas-theme"

export const DEFAULT_CANVAS_THEME: CanvasThemePreference = "match"

export function isCanvasThemePreference(
  value: unknown,
): value is CanvasThemePreference {
  return value === "match" || isThemePreference(value)
}

// Notifies useThemePreference/useResolvedTheme/useCanvasTheme subscribers
// (the Appearance control, the Toaster, an open drawing) whenever a theme
// is applied or either stored choice changes.
const listeners = new Set<() => void>()

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The theme as currently applied to the document — on logged-out pages this
// is light even while a dark choice sits in storage.
export function readResolvedTheme(): ThemePreference {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

/**
 * The single write path for the app theme: toggles the `.dark` class on the
 * root element and keeps the theme-color meta on the matching --background
 * tint. The Excalidraw canvas follows through a subscriber (useCanvasTheme)
 * rather than being written to here.
 */
export function applyResolvedTheme(resolved: ThemePreference) {
  document.documentElement.classList.toggle("dark", resolved === "dark")
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[resolved])
  for (const listener of listeners) listener()
}

/**
 * App theme + canvas override → effective Excalidraw canvas theme: the app
 * theme unless the override pins Light or Dark. Canvas theme is a
 * device-level viewing preference, not a per-Drawing property — the
 * in-canvas theme controls are gone, and any theme baked into a drawing's
 * saved scene state is ignored on load (no migration; saves may keep
 * writing it harmlessly).
 */
export function resolveCanvasTheme(
  appTheme: ThemePreference,
  canvasPreference: CanvasThemePreference,
): ThemePreference {
  return canvasPreference === "match" ? appTheme : canvasPreference
}

// localStorage can throw (privacy modes); an unreadable store means the
// Light default everywhere, so failures are swallowed.
export function readStoredThemePreference(): ThemeChoice | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(stored) ? stored : null
  } catch {
    return null
  }
}

// The Appearance control's write path: persist and apply in one step.
// Writing localStorage can't meaningfully fail, so there is no error flow.
export function setThemePreference(preference: ThemeChoice) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {}
  applyResolvedTheme(resolveThemeChoice(preference))
}

// Invalid or legacy stored values read as Match app, per spec (#111).
export function readStoredCanvasThemePreference(): CanvasThemePreference {
  try {
    const stored = window.localStorage.getItem(CANVAS_THEME_STORAGE_KEY)
    return isCanvasThemePreference(stored) ? stored : DEFAULT_CANVAS_THEME
  } catch {
    return DEFAULT_CANVAS_THEME
  }
}

// Persists the canvas override and notifies subscribers so an open
// drawing re-renders — nothing to apply to the document, the canvas is
// the only consumer.
export function setCanvasThemePreference(preference: CanvasThemePreference) {
  try {
    window.localStorage.setItem(CANVAS_THEME_STORAGE_KEY, preference)
  } catch {}
  for (const listener of listeners) listener()
}

// Logged-out pages are always light regardless of the stored choice; these
// paths and /share/<token> are the only routes that render logged-out.
const LOGGED_OUT_PATHS = ["/login", "/setup", "/invite", "/reset-password"]
const LOGGED_OUT_PREFIX = "/share/"

/**
 * Inlined into the document head (after the theme-color meta) so the right
 * theme is on the root element while the SSR'd HTML is still parsing — a
 * reload never flashes the wrong theme. Dark when explicitly stored, or
 * when System is stored and the OS is dark — never on a logged-out page,
 * where the OS isn't even read. Kept dependency-free because it runs
 * before any bundle.
 */
export const themeBootstrapScript = [
  "try{",
  `var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});`,
  `var d=${JSON.stringify(LOGGED_OUT_PATHS)}.indexOf(location.pathname)<0`,
  `&&location.pathname.indexOf(${JSON.stringify(LOGGED_OUT_PREFIX)})!==0`,
  `&&(t==="dark"||(t==="system"&&window.matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches));`,
  'document.documentElement.classList.toggle("dark",d);',
  "var m=document.querySelector('meta[name=\"theme-color\"]');",
  `if(m)m.setAttribute("content",d?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)});`,
  "}catch(e){}",
].join("")
