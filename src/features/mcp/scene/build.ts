// Turns skeletons into the elements Excalidraw stores, without Excalidraw:
// its converter needs a DOM to measure text. Checks and resolves the input,
// sizes shapes to their labels, and lays out what has no position;
// elements.ts then writes the elements.

import {
  type BuiltElement,
  type ClusterBox,
  type Connector,
  DEFAULT_STYLE,
  emitCluster,
  emitConnector,
  emitFreeText,
  emitShape,
  type FreeText,
  type Label,
  newId,
  PADDING,
  type Shape,
  type ShapeType,
  type Target,
  type TextLayout,
  textBox,
  textSpace,
  withIndices,
} from "./elements"
import { type Box, layoutGraph, type Point, union } from "./layout"
import {
  MAX_ELEMENTS,
  type SceneGraph,
  SceneInputError,
  type ShapeSkeleton,
  type TextSkeleton,
} from "./skeleton"
import { FONT_SIZE, measureText, wrapText } from "./text"

const MIN_SIZE: Record<ShapeType, [number, number]> = {
  rectangle: [120, 60],
  ellipse: [120, 70],
  diamond: [140, 90],
}
// Labels of auto-sized shapes wrap at this width. Diamonds and ellipses
// grow faster than their text, so they wrap sooner.
const AUTO_WRAP_WIDTH: Record<ShapeType, number> = {
  rectangle: 200,
  ellipse: 160,
  diamond: 130,
}
// Room around a label, on top of Excalidraw's padding.
const LABEL_MARGIN = { x: 16, y: 12 }
const FREE_TEXT_MAX_WIDTH = 600
const CLUSTER_FONT_SIZE = 16
// Between hand-placed content and the auto-laid-out block beside it.
const BLOCK_GAP = 100

export type { BuiltElement }

/** What a drawing already holds, for elements added to it. */
export type Drawn = {
  /** Shapes new arrows may join, by element id. */
  targets: Map<string, Target>
  /** Around the existing content; auto-layout goes beside it. */
  bounds: Box | null
}

/**
 * Builds a scene's elements, or the elements added to `drawn`. Throws
 * SceneInputError listing every problem in the input.
 */
export function buildScene(graph: SceneGraph, drawn?: Drawn): BuiltElement[] {
  // Checked first: layout time grows fast with the number of edges.
  const count = graph.elements.length + graph.clusters.length
  if (count > MAX_ELEMENTS) {
    throw new SceneInputError(
      `This scene has ${count} elements; the limit is ${MAX_ELEMENTS}.`,
    )
  }
  const errors: string[] = []
  // Both keyed by ref. Clusters keep the input's parents-first order.
  const clusters = new Map<string, ClusterBox>()
  const shapes = new Map<string, Shape>()
  const refs = new Set<string>()
  const connectors: Connector[] = []
  const texts: FreeText[] = []

  const claim = (ref: string | undefined, where: string) => {
    if (ref === undefined) return
    if (refs.has(ref)) errors.push(`${where}: id "${ref}" is used twice.`)
    else if (drawn?.targets.has(ref))
      errors.push(`${where}: id "${ref}" is already an element's id.`)
    refs.add(ref)
  }

  const clusterOf = new Map<string, string>()
  for (const cluster of graph.clusters) {
    claim(cluster.id, `subgraph ${cluster.id}`)
    for (const member of cluster.members) clusterOf.set(member, cluster.id)
    clusters.set(cluster.id, {
      id: newId(),
      type: "rectangle",
      box: { x: 0, y: 0, width: 0, height: 0 },
      title: labelOf(cluster.label, CLUSTER_FONT_SIZE),
      parent: cluster.parent,
    })
  }

  graph.elements.forEach((element, index) => {
    const where = `elements[${index}]`
    claim(element.id, where)
    const checkPosition = ({ x, y }: { x?: number; y?: number }) => {
      if ((x === undefined) !== (y === undefined))
        errors.push(`${where}: give both x and y, or neither.`)
    }
    switch (element.type) {
      case "rectangle":
      case "ellipse":
      case "diamond": {
        checkPosition(element)
        const id = newId()
        // Without an id of its own, keyed by its random element id, which
        // no client id can collide with.
        shapes.set(element.id ?? id, {
          ...sizeShape(element),
          id,
          type: element.type,
          style: {
            ...DEFAULT_STYLE,
            strokeColor: element.strokeColor ?? DEFAULT_STYLE.strokeColor,
            backgroundColor:
              element.backgroundColor ?? DEFAULT_STYLE.backgroundColor,
            strokeStyle: element.strokeStyle ?? DEFAULT_STYLE.strokeStyle,
          },
          parent: (element.id && clusterOf.get(element.id)) || null,
        })
        break
      }
      case "text": {
        checkPosition(element)
        const { x, y } = element
        texts.push({
          id: newId(),
          skeleton: element,
          layout: freeTextLayout(element),
          position: x !== undefined && y !== undefined ? [x, y] : null,
        })
        break
      }
      case "arrow":
      case "line":
        connectors.push({
          id: newId(),
          index,
          skeleton: element,
          label: element.label
            ? labelOf(element.label, element.fontSize ?? FONT_SIZE)
            : null,
          from: null,
          to: null,
          route: null,
        })
        break
    }
  })

  for (const connector of connectors) {
    const where = `elements[${connector.index}]`
    const { from, to, start, end } = connector.skeleton
    const resolve = (ref: string | undefined, field: string) => {
      if (ref === undefined) return null
      const target =
        shapes.get(ref) ?? clusters.get(ref) ?? drawn?.targets.get(ref)
      if (!target) {
        errors.push(
          refs.has(ref)
            ? `${where}.${field}: "${ref}" is not a shape.`
            : `${where}.${field}: no shape has id "${ref}".`,
        )
      }
      return target ?? null
    }
    connector.from = resolve(from, "from")
    connector.to = resolve(to, "to")
    if (from === undefined && start === undefined)
      errors.push(`${where}: give "from" (a shape id) or "start" (a point).`)
    if (to === undefined && end === undefined)
      errors.push(`${where}: give "to" (a shape id) or "end" (a point).`)
  }

  if (errors.length > 0) throw new SceneInputError(errors.join("\n"))

  autoLayout(
    graph.direction,
    clusters,
    shapes,
    connectors,
    texts,
    drawn?.bounds ?? null,
  )

  const boundTo = (target: Target) =>
    connectors.flatMap(({ id, from, to }) =>
      from === target || to === target ? [{ id, type: "arrow" as const }] : [],
    )
  // Outer clusters first, so each box sits behind what it holds.
  return withIndices([
    ...[...clusters.values()].flatMap((cluster) =>
      emitCluster(cluster, boundTo(cluster)),
    ),
    ...[...shapes.values()].flatMap((shape) =>
      emitShape(shape, boundTo(shape)),
    ),
    ...connectors.flatMap(emitConnector),
    ...texts.map(emitFreeText),
  ])
}

export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").trim()
}

/** A label that doesn't wrap. */
function labelOf(text: string, fontSize: number): Label | null {
  const original = cleanText(text)
  return original ? { text: original, original, fontSize } : null
}

// Excalidraw's computeContainerDimensionForBoundText: the container size
// whose text box is `dimension`.
export function containerSize(type: ShapeType, dimension: number): number {
  const size = Math.ceil(dimension)
  if (type === "ellipse")
    return Math.round(((size + PADDING * 2) / Math.SQRT2) * 2)
  if (type === "diamond") return 2 * (size + PADDING * 2)
  return size + PADDING * 2
}

/**
 * A shape's box, grown where its label would not fit: missing sizes fit the
 * label, and a given height grows rather than let the label spill.
 */
function sizeShape(
  skeleton: ShapeSkeleton,
): Pick<Shape, "box" | "positioned" | "label"> {
  const { type } = skeleton
  const [minWidth, minHeight] = MIN_SIZE[type]
  const fontSize = skeleton.fontSize ?? FONT_SIZE
  const original = cleanText(skeleton.label ?? "")
  let label: Label | null = null
  let width = skeleton.width
  let height = skeleton.height
  if (original) {
    if (width === undefined) {
      const fit = measureText(
        wrapText(original, fontSize, AUTO_WRAP_WIDTH[type]),
        fontSize,
      )
      width = Math.max(
        minWidth,
        containerSize(type, fit.width + LABEL_MARGIN.x * 2),
      )
    }
    const text = wrapText(original, fontSize, textSpace(type, width))
    label = { text, original, fontSize }
    const textHeight = measureText(text, fontSize).height
    height =
      height === undefined
        ? Math.max(
            minHeight,
            containerSize(type, textHeight + LABEL_MARGIN.y * 2),
          )
        : Math.max(height, containerSize(type, textHeight))
  }
  return {
    box: {
      x: skeleton.x ?? 0,
      y: skeleton.y ?? 0,
      width: width ?? minWidth,
      height: height ?? minHeight,
    },
    positioned: skeleton.x !== undefined && skeleton.y !== undefined,
    label,
  }
}

/**
 * Lays out the shapes with no position, and every cluster, as one graph
 * beside the hand-placed content, then stacks unplaced text above it all.
 */
function autoLayout(
  direction: SceneGraph["direction"],
  clustersByRef: Map<string, ClusterBox>,
  shapesByRef: Map<string, Shape>,
  connectors: Connector[],
  texts: FreeText[],
  drawnBounds: Box | null,
) {
  const clusters = [...clustersByRef.values()]
  const shapes = [...shapesByRef.values()]
  const placed = shapes.filter((shape) => shape.positioned)
  const floating = shapes.filter((shape) => !shape.positioned)
  const placedBounds = boundsOf([
    ...(drawnBounds ? [drawnBounds] : []),
    ...placed.map((shape) => shape.box),
    ...connectors.flatMap(({ skeleton }) =>
      [skeleton.start, skeleton.end].flatMap((point) =>
        point ? [{ x: point[0], y: point[1], width: 0, height: 0 }] : [],
      ),
    ),
    ...texts.flatMap((text) => (text.position ? [textBox(text)] : [])),
  ])

  if (floating.length > 0 || clusters.length > 0) {
    // Edges to a cluster can't be laid out; they are drawn straight.
    const floatingIds = new Set(floating.map((shape) => shape.id))
    const routed = connectors.filter(
      (connector): connector is Connector & { from: Shape; to: Shape } =>
        connector.from !== null &&
        connector.to !== null &&
        floatingIds.has(connector.from.id) &&
        floatingIds.has(connector.to.id),
    )
    const parentId = (item: Shape | ClusterBox) =>
      (item.parent && clustersByRef.get(item.parent)?.id) || null
    const layout = layoutGraph({
      direction,
      nodes: floating.map((shape) => ({
        id: shape.id,
        width: shape.box.width,
        height: shape.box.height,
        parent: parentId(shape),
      })),
      edges: routed.map(({ from, to, label }) => ({
        from: from.id,
        to: to.id,
        label: label ? measureText(label.text, label.fontSize) : undefined,
      })),
      clusters: clusters.map((cluster) => ({
        id: cluster.id,
        parent: parentId(cluster),
        titleHeight: cluster.title
          ? measureText(cluster.title.text, cluster.title.fontSize).height +
            PADDING * 2
          : 0,
      })),
    })
    const [left, top] = placedBounds
      ? [placedBounds.x + placedBounds.width + BLOCK_GAP, placedBounds.y]
      : [0, 0]
    const shift = (box: Box): Box => ({
      ...box,
      x: box.x + left,
      y: box.y + top,
    })
    for (const shape of floating) {
      const box = layout.nodes.get(shape.id)
      if (box) shape.box = shift(box)
    }
    for (const cluster of clusters) {
      const box = layout.clusters.get(cluster.id)
      if (box) cluster.box = shift(box)
    }
    routed.forEach((connector, index) => {
      connector.route = layout.edges[index].map(
        ([x, y]): Point => [x + left, y + top],
      )
    })
  }

  // Cluster titles don't wrap: the box widens to fit them instead.
  for (const { box, title } of clusters) {
    if (!title) continue
    const { width } = measureText(title.text, title.fontSize)
    box.width = Math.max(box.width, width + PADDING * 2 + 10)
  }

  const unplaced = texts.filter((text) => !text.position)
  const bounds = boundsOf([
    ...clusters.map((cluster) => cluster.box),
    ...shapes.map((shape) => shape.box),
    ...(placedBounds ? [placedBounds] : []),
  ])
  const heights = unplaced.map((text) => text.layout.height)
  const stackHeight = heights.reduce((sum, height) => sum + height + 20, 0)
  let y = bounds ? bounds.y - 40 - stackHeight : 0
  for (const [index, text] of unplaced.entries()) {
    text.position = [bounds?.x ?? 0, y]
    y += heights[index] + 20
  }
}

function boundsOf(boxes: Box[]): Box | null {
  return boxes.length > 0 ? boxes.reduce(union) : null
}

/** Free text wraps only past FREE_TEXT_MAX_WIDTH; then its width is fixed. */
function freeTextLayout(skeleton: TextSkeleton): TextLayout {
  const fontSize = skeleton.fontSize ?? FONT_SIZE
  const original = cleanText(skeleton.text)
  const natural = measureText(original, fontSize)
  if (natural.width <= FREE_TEXT_MAX_WIDTH) {
    return { fontSize, original, text: original, ...natural, autoResize: true }
  }
  const text = wrapText(original, fontSize, FREE_TEXT_MAX_WIDTH)
  return {
    fontSize,
    original,
    text,
    width: FREE_TEXT_MAX_WIDTH,
    height: measureText(text, fontSize).height,
    autoResize: false,
  }
}
