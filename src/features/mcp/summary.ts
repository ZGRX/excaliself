// read_drawing's view of a scene: what an LLM needs to understand a drawing
// (shapes and their labels, text, what connects to what, what sits inside
// what) in a few lines, instead of the raw element JSON. Each line carries
// its element's id, which edit_drawing takes.

type Box = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type End = { boundId: string; at: Point; arrowhead: boolean }

/** The fields the summary reads, out of an element's untyped JSON. */
type Item = {
  id: string
  type: string
  box: Box
  /** A text's original (unwrapped) text. */
  text: string
  containerId: string
  frameId: string
  name: string
  fill: string
  strokeStyle: string
  /** A connector's ends; for other elements, unused. */
  start: End
  end: End
}

const SHAPE_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "image",
  "frame",
  "magicframe",
  "embeddable",
  "iframe",
])
// An unattached arrow end this close to a shape is read as pointing at it.
const NEAR = 20
const MAX_ITEMS = 200
const MAX_TEXT = 300

function read(element: Record<string, unknown>): Item {
  const num = (value: unknown) => (typeof value === "number" ? value : 0)
  const str = (value: unknown) => (typeof value === "string" ? value : "")
  const x = num(element.x)
  const y = num(element.y)
  const points: unknown[] = Array.isArray(element.points) ? element.points : []
  const end = (binding: unknown, point: unknown, arrowhead: unknown): End => {
    const [dx, dy]: unknown[] = Array.isArray(point) ? point : []
    return {
      boundId:
        binding && typeof binding === "object" && "elementId" in binding
          ? str(binding.elementId)
          : "",
      at: { x: x + num(dx), y: y + num(dy) },
      arrowhead: Boolean(arrowhead),
    }
  }
  return {
    id: str(element.id),
    type: str(element.type),
    box: {
      x,
      y,
      width: Math.abs(num(element.width)),
      height: Math.abs(num(element.height)),
    },
    text: str(element.originalText) || str(element.text),
    containerId: str(element.containerId),
    frameId: str(element.frameId),
    name: str(element.name),
    fill: str(element.backgroundColor),
    strokeStyle: str(element.strokeStyle),
    start: end(element.startBinding, points[0], element.startArrowhead),
    end: end(element.endBinding, points.at(-1), element.endArrowhead),
  }
}

const contains = (outer: Box, inner: Box, margin = 0) =>
  inner.x >= outer.x - margin &&
  inner.y >= outer.y - margin &&
  inner.x + inner.width <= outer.x + outer.width + margin &&
  inner.y + inner.height <= outer.y + outer.height + margin

const quote = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return JSON.stringify(
    flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat,
  )
}

const at = ({ x, y }: { x: number; y: number }) =>
  `(${Math.round(x)}, ${Math.round(y)})`

const idOf = ({ id }: Item) => `[id ${id}]`

function capped(lines: string[]): string[] {
  return lines.length > MAX_ITEMS
    ? [...lines.slice(0, MAX_ITEMS), `… and ${lines.length - MAX_ITEMS} more`]
    : lines
}

const area = ({ box }: Item) => box.width * box.height

function smallest(items: Item[]): Item | undefined {
  return items.reduce<Item | undefined>(
    (best, item) => (!best || area(item) < area(best) ? item : best),
    undefined,
  )
}

export function summarizeScene(
  elements: readonly Record<string, unknown>[],
): string {
  const live = elements.filter((element) => !element.isDeleted).map(read)
  if (live.length === 0) return "The drawing is empty."
  const byId = new Map(live.map((item) => [item.id, item]))

  const labels = new Map<string, string>()
  const freeTexts: Item[] = []
  for (const item of live) {
    if (item.type !== "text") continue
    if (item.containerId && byId.has(item.containerId))
      labels.set(item.containerId, item.text)
    else freeTexts.push(item)
  }

  const readingOrder = (a: Item, b: Item) =>
    a.box.y - b.box.y || a.box.x - b.box.x
  const shapes = live
    .filter((item) => SHAPE_TYPES.has(item.type))
    .sort(readingOrder)
  const refs = new Map(
    shapes.map((shape, index) => [shape.id, `S${index + 1}`]),
  )
  const name = (shape: Item) => {
    const label = labels.get(shape.id) ?? shape.name
    return label
      ? `${refs.get(shape.id)} ${quote(label)}`
      : `${refs.get(shape.id)}`
  }

  // The smallest other shape fully around a box, if any.
  const enclosing = (self: Item) =>
    smallest(
      shapes.filter(
        (shape) =>
          shape !== self &&
          shape.type !== "image" &&
          contains(shape.box, self.box) &&
          !contains(self.box, shape.box),
      ),
    )
  const placement = (item: Item) => {
    const frame = byId.get(item.frameId)
    if (frame) return `, in frame ${name(frame)}`
    const outer = enclosing(item)
    return outer ? `, inside ${refs.get(outer.id)}` : ""
  }

  const shapeLines = shapes.map((shape) => {
    const { x, y, width, height } = shape.box
    const details = [
      `${name(shape)} ${idOf(shape)}: ${shape.type} at ${at({ x, y })}, ${Math.round(width)}×${Math.round(height)}`,
    ]
    if (shape.fill && shape.fill !== "transparent")
      details.push(`, fill ${shape.fill}`)
    if (shape.strokeStyle && shape.strokeStyle !== "solid")
      details.push(`, ${shape.strokeStyle}`)
    return details.join("") + placement(shape)
  })

  // An end attached by binding, else read off what it lies on or near.
  const describeEnd = ({ boundId, at: point }: End) => {
    const bound = byId.get(boundId)
    if (bound && refs.has(bound.id)) return name(bound)
    if (bound?.type === "text") return `text ${quote(bound.text)}`
    const near = smallest(
      shapes.filter((shape) =>
        contains(shape.box, { ...point, width: 0, height: 0 }, NEAR),
      ),
    )
    return near ? `${name(near)} (not attached)` : at(point)
  }
  const connectors = live.filter(
    (item) => item.type === "arrow" || item.type === "line",
  )
  const connectorLines = connectors.map((connector) => {
    const start = describeEnd(connector.start)
    const end = describeEnd(connector.end)
    const heads = [connector.start.arrowhead, connector.end.arrowhead]
    const kind = connector.type === "line" ? "line" : "arrow"
    const line =
      heads[1] && !heads[0]
        ? `${start} → ${end}`
        : heads[0] && !heads[1]
          ? `${end} → ${start}`
          : heads[0] && heads[1]
            ? `${start} ↔ ${end}`
            : `${start} — ${end} (${kind}, no arrowheads)`
    const label = labels.get(connector.id)
    const style =
      connector.strokeStyle && connector.strokeStyle !== "solid"
        ? `, ${connector.strokeStyle}`
        : ""
    return `${line} ${idOf(connector)}${label ? `, labeled ${quote(label)}` : ""}${style}`
  })

  const textLines = freeTexts
    .sort(readingOrder)
    .map(
      (text) =>
        `${quote(text.text)} ${idOf(text)} at ${at(text.box)}${placement(text)}`,
    )

  const freedraws = live.filter((item) => item.type === "freedraw").length
  const sections = [
    `${live.length} elements. Positions are canvas pixels (x right, y down); S1, S2, … name shapes in reading order; [id …] is the element's id.`,
  ]
  const section = (title: string, lines: string[]) => {
    if (lines.length > 0)
      sections.push(`${title}:\n${capped(lines).join("\n")}`)
  }
  section("Shapes", shapeLines)
  section("Connections", connectorLines)
  section("Text", textLines)
  if (freedraws > 0)
    sections.push(
      `Also ${freedraws} freehand stroke${freedraws === 1 ? "" : "s"}.`,
    )
  return sections.join("\n\n")
}
