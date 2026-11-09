// How the MCP comment tools see anchors: an element's label for list_comments,
// and where add_comment pins a thread. Reads untyped scene JSON.

import type { NewAnchor, ThreadAnchor } from "@/features/comments/anchor"

type Element = Record<string, unknown>

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0
const str = (value: unknown) => (typeof value === "string" ? value : "")
const live = (element: Element | undefined) =>
  element !== undefined && element.isDeleted !== true

/** `rectangle "Login"`, or just the type when it has no text. */
function labelOf(element: Element, elements: Element[]): string {
  const bound = elements.find(
    (other) => live(other) && other.containerId === element.id,
  )
  const words =
    str((bound ?? element).originalText) || str((bound ?? element).text)
  return words
    ? `${str(element.type)} ${JSON.stringify(words)}`
    : str(element.type)
}

/** A thread's anchor as list_comments reports it. */
export function describeAnchor(thread: ThreadAnchor, elements: Element[]) {
  if (thread.elementId === null) return { point: { x: thread.x, y: thread.y } }
  const element = elements.find((el) => el.id === thread.elementId)
  return live(element) && element
    ? { element: { id: thread.elementId, label: labelOf(element, elements) } }
    : { element: { id: thread.elementId, deleted: true } }
}

/**
 * Where add_comment pins a thread: the middle of the element, else the
 * top-left of the drawing's content. Bound text pins to its shape.
 */
export function anchorForTool(
  elements: Element[],
  elementId: string | undefined,
): NewAnchor {
  const shown = elements.filter(live)
  if (elementId === undefined) {
    if (shown.length === 0) return { x: 0, y: 0 }
    return {
      x: Math.min(...shown.map((el) => num(el.x))),
      y: Math.min(...shown.map((el) => num(el.y))),
    }
  }
  let element = shown.find((el) => el.id === elementId)
  if (!element)
    throw new Error(
      "No element has that id in this drawing. Find one with read_drawing.",
    )
  const container = shown.find((el) => el.id === element?.containerId)
  if (container) element = container
  return {
    x: num(element.x) + num(element.width) / 2,
    y: num(element.y) + num(element.height) / 2,
    elementId: str(element.id),
    offsetX: 0.5,
    offsetY: 0.5,
  }
}
