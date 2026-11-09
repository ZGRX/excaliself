// Where a thread's pin sits, from the live scene. Pure, and free of Excalidraw
// imports, so it runs anywhere and stays out of the server bundle.

/** The element fields a pin reads. Excalidraw elements fit as they are. */
export type AnchorElement = {
  id: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  isDeleted?: boolean
  /** Set on text bound inside a shape. */
  containerId?: string | null
  /** Linear and freedraw elements: points relative to (x, y). */
  points?: readonly (readonly [number, number])[]
}

/** The anchor columns of a thread. */
export type ThreadAnchor = {
  x: number
  y: number
  elementId: string | null
  offsetX: number | null
  offsetY: number | null
}

export type NewAnchor =
  | { x: number; y: number }
  | {
      x: number
      y: number
      elementId: string
      offsetX: number
      offsetY: number
    }

type Point = { x: number; y: number }
type Box = { x: number; y: number; width: number; height: number }

/** The unrotated box; linear elements' points can start left of or above (x, y). */
function boxOf(element: AnchorElement): Box {
  const { points } = element
  if (!points || points.length === 0)
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    }
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: element.x + minX,
    y: element.y + minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  }
}

function rotate(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

const centerOf = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
})

/**
 * The pin's scene point now. An element anchor follows its element's move,
 * resize, and rotation; with the element deleted it stays at the tombstone,
 * or at the point where it was made once the tombstone is gone.
 */
export function pinPosition(
  thread: ThreadAnchor,
  elements: ReadonlyMap<string, AnchorElement>,
): Point & { detached: boolean } {
  const { elementId, offsetX, offsetY } = thread
  if (elementId === null || offsetX === null || offsetY === null)
    return { x: thread.x, y: thread.y, detached: false }
  const element = elements.get(elementId)
  if (!element) return { x: thread.x, y: thread.y, detached: true }
  const box = boxOf(element)
  const point = rotate(
    { x: box.x + offsetX * box.width, y: box.y + offsetY * box.height },
    centerOf(box),
    element.angle,
  )
  return { ...point, detached: element.isDeleted === true }
}

const clampFraction = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5

/**
 * The anchor for a click at a scene point: the smallest live element under
 * it (bound text counts as its shape), else the point itself. `tolerance`
 * widens each box, in scene units, so thin lines can be hit.
 */
export function anchorAt(
  point: Point,
  elements: readonly AnchorElement[],
  tolerance: number,
): NewAnchor {
  const byId = new Map(elements.map((element) => [element.id, element]))
  let hit: AnchorElement | undefined
  let hitArea = Number.POSITIVE_INFINITY
  for (const element of elements) {
    if (element.isDeleted) continue
    const box = boxOf(element)
    const local = rotate(point, centerOf(box), -element.angle)
    if (
      local.x < box.x - tolerance ||
      local.x > box.x + box.width + tolerance ||
      local.y < box.y - tolerance ||
      local.y > box.y + box.height + tolerance
    )
      continue
    const area = box.width * box.height
    if (area < hitArea) {
      hit = element
      hitArea = area
    }
  }
  if (hit?.containerId) {
    const container = byId.get(hit.containerId)
    if (container && !container.isDeleted) hit = container
  }
  if (!hit) return { x: point.x, y: point.y }

  const box = boxOf(hit)
  const local = rotate(point, centerOf(box), -hit.angle)
  return {
    x: point.x,
    y: point.y,
    elementId: hit.id,
    offsetX: clampFraction((local.x - box.x) / box.width),
    offsetY: clampFraction((local.y - box.y) / box.height),
  }
}
