import type { Drawing } from "./queries"

/**
 * The words in a scene: every live text element, which includes labels bound
 * to shapes and arrows. Whitespace is collapsed so wrapped lines read as one
 * line. Stored as `drawings.searchText` on every write; migration 0008
 * mirrors this in SQL for the backfill.
 */
export function sceneText(
  elements: readonly Record<string, unknown>[],
): string {
  return (
    elements
      .filter((element) => element.type === "text" && !element.isDeleted)
      // originalText is the unwrapped source; text has container wrapping
      .map((element) => {
        const text = element.originalText ?? element.text
        return typeof text === "string" ? text : ""
      })
      .join(" ")
      // Postgres text can't hold U+0000, so one would fail every write
      .replaceAll("\u0000", "")
      .replace(/\s+/g, " ")
      .trim()
  )
}

/** A stored scene's elements, or null when its JSON can't be read. */
export function parseSceneElements(
  data: string,
): Record<string, unknown>[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const elements = (parsed as { elements?: unknown } | null)?.elements
  if (!Array.isArray(elements)) return []
  return elements.filter(
    (element): element is Record<string, unknown> =>
      typeof element === "object" && element !== null,
  )
}

/** {@link sceneText} of a stored scene; empty when it can't be read. */
export function extractSceneText(data: string): string {
  return sceneText(parseSceneElements(data) ?? [])
}

// Short lead keeps the match in view next to a long title in the palette
const SNIPPET_LEAD = 12
const SNIPPET_LENGTH = 80

/**
 * A short excerpt around the first case-insensitive match of `query` in the
 * drawing's scene text, or null when the scene doesn't contain it. Callers
 * truncate the tail in CSS.
 */
export function findInScene(
  drawing: Pick<Drawing, "searchText">,
  query: string,
): string | null {
  const needle = query.trim().toLowerCase()
  if (needle === "") return null
  const text = drawing.searchText
  const at = text.toLowerCase().indexOf(needle)
  if (at === -1) return null
  // Lead in from a word start; no space before the lead means start at 0
  const start =
    at <= SNIPPET_LEAD ? 0 : text.lastIndexOf(" ", at - SNIPPET_LEAD) + 1
  return `${start > 0 ? "…" : ""}${text.slice(start, start + SNIPPET_LENGTH)}`
}

/**
 * Search for AI clients: every word of the query must be in the name or the
 * text, in any order. The app's own search (`filterDrawings`) matches the
 * query as one phrase. The snippet shows the first word found in the text.
 */
export function matchDrawing(
  drawing: Pick<Drawing, "name" | "searchText">,
  query: string,
): { match: "name" | "text"; snippet: string | null } | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const name = drawing.name.toLowerCase()
  const text = drawing.searchText.toLowerCase()
  const found = (word: string) => name.includes(word) || text.includes(word)
  if (words.length === 0 || !words.every(found)) return null
  const textWord = words.find((word) => text.includes(word))
  return {
    match: words.every((word) => name.includes(word)) ? "name" : "text",
    snippet: textWord ? findInScene(drawing, textWord) : null,
  }
}
