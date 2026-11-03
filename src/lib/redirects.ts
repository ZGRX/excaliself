// Guards the ?redirect= param on /login against open redirects: only
// same-origin relative paths come back, anything else lands on the
// fallback.
const FALLBACK = "/draw"
const PROBE_ORIGIN = "http://probe.invalid"

export function resolveRedirect(value: string | undefined): string {
  if (!value?.startsWith("/")) return FALLBACK
  // Browsers strip tab/CR/LF when parsing URLs (so "/\t/evil" navigates
  // as "//evil") and treat backslashes as slashes — reject all four.
  if (/[\t\r\n\\]/.test(value)) return FALLBACK
  let url: URL
  try {
    url = new URL(value, PROBE_ORIGIN)
  } catch {
    return FALLBACK
  }
  // A value that escapes the probe origin (e.g. "//evil.example") is
  // not a relative path.
  if (url.origin !== PROBE_ORIGIN) return FALLBACK
  // Dot segments are removed after the host is picked, so "/.//evil"
  // keeps the probe origin but normalizes to "//evil". The parser turns
  // backslashes into slashes, so this check also covers "/\".
  if (url.pathname.startsWith("//")) return FALLBACK
  return url.pathname + url.search + url.hash
}
