// The laid-out scene model, and how it becomes the elements Excalidraw
// stores. Mirrors the editor's own rules for bound text (padding, max width,
// centering) and arrow bindings, so a built scene opens as if it had been
// drawn by hand.

import { randomBytes, randomInt } from "node:crypto"
import type { SceneElement } from "@/features/collab/protocol"
import type { Box, Point } from "./layout"
import type { ConnectorSkeleton, ShapeSkeleton, TextSkeleton } from "./skeleton"
import { LINE_HEIGHT, measureText, wrapText } from "./text"

export type ShapeType = ShapeSkeleton["type"]

// Excalidraw's BOUND_TEXT_PADDING.
export const PADDING = 5
const BINDING_GAP = 6

export type Style = {
  strokeColor: string
  backgroundColor: string
  strokeStyle: "solid" | "dashed" | "dotted"
  strokeWidth: number
}

export const DEFAULT_STYLE: Style = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  strokeStyle: "solid",
  strokeWidth: 2,
}

const CLUSTER_STYLE: Style = {
  ...DEFAULT_STYLE,
  strokeColor: "#868e96",
  backgroundColor: "#f8f9fa",
  strokeStyle: "dashed",
}

export type Label = { text: string; original: string; fontSize: number }

export type Shape = {
  id: string
  type: ShapeType
  box: Box
  positioned: boolean
  label: Label | null
  style: Style
  /** Ref of the cluster this sits in. */
  parent: string | null
}

/** A subgraph's titled box. Always laid out, around its members. */
export type ClusterBox = {
  id: string
  /** A cluster binds and draws like a rectangle. */
  type: "rectangle"
  box: Box
  title: Label | null
  /** Ref of the cluster this sits in. */
  parent: string | null
}

/** What an arrow can join: a new shape, a cluster, or a shape already drawn. */
export type Target = { id: string; type: ShapeType; box: Box }

export type Connector = {
  id: string
  index: number
  skeleton: ConnectorSkeleton
  label: Label | null
  from: Target | null
  to: Target | null
  /** Set when the auto-layout routed it. */
  route: Point[] | null
}

export type TextLayout = Label & {
  width: number
  height: number
  autoResize: boolean
}

export type FreeText = {
  id: string
  skeleton: TextSkeleton
  layout: TextLayout
  position: Point | null
}

/** A built element, with the fields every element has typed. */
export type BuiltElement = SceneElement & {
  type: string
  x: number
  y: number
  width: number
  height: number
}

type BoundElement = { id: string; type: "arrow" | "text" }

export function newId(): string {
  return randomBytes(15).toString("base64url")
}

// Excalidraw's getBoundTextMaxWidth / getBoundTextMaxHeight (the same
// formula): the room for a label along one side of a container.
export function textSpace(type: ShapeType, size: number): number {
  if (type === "ellipse")
    return Math.round((size / 2) * Math.SQRT2) - PADDING * 2
  if (type === "diamond") return Math.round(size / 2) - PADDING * 2
  return size - PADDING * 2
}

export function textBox({ layout, position }: FreeText): Box {
  const [x, y] = position ?? [0, 0]
  return { x, y, width: layout.width, height: layout.height }
}

function base(
  id: string,
  type: string,
  box: Box,
  style: Style,
  links: { roundness: { type: number } | null; boundElements: BoundElement[] },
) {
  return {
    id,
    type,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    angle: 0,
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    fillStyle: "solid",
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: links.roundness,
    seed: randomInt(1, 2 ** 31),
    version: 1,
    versionNonce: randomInt(1, 2 ** 31),
    isDeleted: false,
    boundElements: links.boundElements,
    updated: Date.now(),
    link: null,
    locked: false,
  }
}

function textElement(options: {
  id: string
  box: Box
  label: Label
  strokeColor: string
  containerId: string | null
  textAlign: "left" | "center"
  verticalAlign: "top" | "middle"
  autoResize: boolean
}) {
  return {
    ...base(
      options.id,
      "text",
      options.box,
      { ...DEFAULT_STYLE, strokeColor: options.strokeColor },
      { roundness: null, boundElements: [] },
    ),
    fontSize: options.label.fontSize,
    // Excalifont
    fontFamily: 5,
    text: options.label.text,
    originalText: options.label.original,
    textAlign: options.textAlign,
    verticalAlign: options.verticalAlign,
    containerId: options.containerId,
    autoResize: options.autoResize,
    lineHeight: LINE_HEIGHT,
  }
}

type TextElement = ReturnType<typeof textElement>

/** A container and its label, each pointing at the other. */
function withText<Container extends { boundElements: BoundElement[] }>(
  container: Container,
  text: TextElement | null,
) {
  if (!text) return [container]
  const boundElements = [
    { id: text.id, type: "text" as const },
    ...container.boundElements,
  ]
  return [{ ...container, boundElements }, text]
}

export function emitShape(shape: Shape, arrows: BoundElement[]) {
  const roundness =
    shape.type === "ellipse"
      ? null
      : { type: shape.type === "rectangle" ? 3 : 2 }
  return withText(
    base(shape.id, shape.type, shape.box, shape.style, {
      roundness,
      boundElements: arrows,
    }),
    shape.label && boundText(shape, shape.label, shape.style.strokeColor),
  )
}

/** Excalidraw's computeBoundTextPosition: centered in the container's text box. */
export function boundText(
  container: Target,
  label: Label,
  strokeColor: string,
) {
  const { type, box } = container
  const size = measureText(label.text, label.fontSize)
  let insetX = PADDING
  let insetY = PADDING
  if (type === "ellipse") {
    insetX += (box.width / 2) * (1 - Math.SQRT2 / 2)
    insetY += (box.height / 2) * (1 - Math.SQRT2 / 2)
  } else if (type === "diamond") {
    insetX += box.width / 4
    insetY += box.height / 4
  }
  return textElement({
    id: newId(),
    box: {
      x: box.x + insetX + (textSpace(type, box.width) - size.width) / 2,
      y: box.y + insetY + (textSpace(type, box.height) - size.height) / 2,
      ...size,
    },
    label,
    strokeColor,
    containerId: container.id,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: true,
  })
}

/** A dashed gray box, its title bound top-left. */
export function emitCluster(cluster: ClusterBox, arrows: BoundElement[]) {
  const { id, box, title } = cluster
  return withText(
    base(id, "rectangle", box, CLUSTER_STYLE, {
      roundness: { type: 3 },
      boundElements: arrows,
    }),
    title &&
      textElement({
        id: newId(),
        box: {
          x: box.x + PADDING,
          y: box.y + PADDING,
          ...measureText(title.text, title.fontSize),
        },
        label: title,
        strokeColor: "#495057",
        containerId: id,
        textAlign: "left",
        verticalAlign: "top",
        autoResize: true,
      }),
  )
}

export function center({ box }: Target): Point {
  return [box.x + box.width / 2, box.y + box.height / 2]
}

/** Where a ray from the target's center toward `toward` leaves its outline, plus the binding gap. */
export function outlinePoint(target: Target, toward: Point): Point {
  const [cx, cy] = center(target)
  let dx = toward[0] - cx
  const dy = toward[1] - cy
  if (dx === 0 && dy === 0) dx = 1
  const halfWidth = target.box.width / 2
  const halfHeight = target.box.height / 2
  const scale =
    target.type === "ellipse"
      ? 1 / Math.hypot(dx / halfWidth, dy / halfHeight)
      : target.type === "diamond"
        ? 1 / (Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight)
        : Math.min(halfWidth / Math.abs(dx), halfHeight / Math.abs(dy))
  const length = Math.hypot(dx, dy)
  return [
    cx + dx * scale + (dx / length) * BINDING_GAP,
    cy + dy * scale + (dy / length) * BINDING_GAP,
  ]
}

/** Drops route bends too slight to matter, so most edges come out straight. */
function simplify(points: Point[]): Point[] {
  const kept = [...points]
  for (let index = 1; index < kept.length - 1; ) {
    const [ax, ay] = kept[index - 1]
    const [px, py] = kept[index]
    const [bx, by] = kept[index + 1]
    const length = Math.hypot(bx - ax, by - ay)
    const offLine =
      length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
    if (offLine < 4) kept.splice(index, 1)
    else index++
  }
  return kept
}

function connectorPoints({ skeleton, from, to, route }: Connector): Point[] {
  // Validation guarantees a point wherever there is no shape.
  const anchor = (target: Target | null, point: number[] | undefined): Point =>
    target ? center(target) : [point?.[0] ?? 0, point?.[1] ?? 0]
  let points: Point[]
  if (route) {
    points = simplify(route)
  } else if (from && from === to) {
    // A loop off the top-right corner.
    const { x, y, width, height } = from.box
    points = [
      [x + width * 0.75, y],
      [x + width + 40, y - 40],
      [x + width, y + height * 0.25],
    ]
  } else {
    points = [anchor(from, skeleton.start), anchor(to, skeleton.end)]
  }
  if (from) points[0] = outlinePoint(from, points[1])
  if (to)
    points[points.length - 1] = outlinePoint(to, points[points.length - 2])
  return points
}

// Excalidraw puts an arrow's label on its middle point, or the middle of its
// middle segment.
function midpoint(points: Point[]): Point {
  if (points.length % 2 === 1) return points[Math.floor(points.length / 2)]
  const [ax, ay] = points[points.length / 2 - 1]
  const [bx, by] = points[points.length / 2]
  return [(ax + bx) / 2, (ay + by) / 2]
}

export function emitConnector(connector: Connector) {
  const { skeleton, from, to } = connector
  const points = connectorPoints(connector)
  const [x0, y0] = points[0]
  const local = points.map(([x, y]): Point => [x - x0, y - y0])
  const xs = local.map(([x]) => x)
  const ys = local.map(([, y]) => y)
  const box = {
    x: x0,
    y: y0,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
  const isLine = skeleton.type === "line"
  // A line attached to shapes is an arrow without heads: lines can't bind.
  const type = isLine && !from && !to ? "line" : "arrow"
  const strokeColor = skeleton.strokeColor ?? DEFAULT_STYLE.strokeColor
  const binding = (target: Target | null) =>
    target ? { elementId: target.id, focus: 0, gap: BINDING_GAP } : null

  const element = {
    ...base(
      connector.id,
      type,
      box,
      {
        ...DEFAULT_STYLE,
        strokeColor,
        strokeStyle: skeleton.strokeStyle ?? DEFAULT_STYLE.strokeStyle,
        strokeWidth: skeleton.strokeWidth ?? DEFAULT_STYLE.strokeWidth,
      },
      { roundness: { type: 2 }, boundElements: [] },
    ),
    points: local,
    lastCommittedPoint: null,
    startBinding: type === "arrow" ? binding(from) : null,
    endBinding: type === "arrow" ? binding(to) : null,
    startArrowhead:
      skeleton.startArrowhead === undefined ? null : skeleton.startArrowhead,
    endArrowhead:
      skeleton.endArrowhead === undefined
        ? isLine
          ? null
          : "arrow"
        : skeleton.endArrowhead,
    ...(type === "arrow" ? { elbowed: false } : {}),
  }
  const { label } = connector
  if (type !== "arrow" || !label) return [element]
  return withText(
    element,
    arrowLabel(connector.id, points, box.width, label, strokeColor),
  )
}

/** An arrow's label, on its middle. `points` are absolute. */
export function arrowLabel(
  arrowId: string,
  points: Point[],
  arrowWidth: number,
  label: Label,
  strokeColor: string,
) {
  // Excalidraw's getBoundTextMaxWidth for arrows.
  const maxWidth = Math.max(arrowWidth * 0.7, label.fontSize * 11)
  const text = wrapText(label.original, label.fontSize, maxWidth)
  const size = measureText(text, label.fontSize)
  const [mx, my] = midpoint(points)
  return textElement({
    id: newId(),
    box: { x: mx - size.width / 2, y: my - size.height / 2, ...size },
    label: { ...label, text },
    strokeColor,
    containerId: arrowId,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: true,
  })
}

export function emitFreeText(text: FreeText) {
  return textElement({
    id: text.id,
    box: textBox(text),
    label: text.layout,
    strokeColor: text.skeleton.strokeColor ?? DEFAULT_STYLE.strokeColor,
    containerId: null,
    textAlign: "left",
    verticalAlign: "top",
    autoResize: text.layout.autoResize,
  })
}

const BASE_62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/**
 * Fractional indices in array order: "c" and three base-62 digits, an
 * integer key in Excalidraw's scheme. Not the fractional-indexing package:
 * the server bundle would load it from Excalidraw's chunk, and with it
 * Excalidraw, which needs a browser.
 */
export function withIndices<T extends object>(
  elements: T[],
): (T & { index: string })[] {
  return elements.map((element, position) => {
    const digit = (place: number) =>
      BASE_62[Math.floor(position / 62 ** place) % 62]
    return { ...element, index: `c${digit(2)}${digit(1)}${digit(0)}` }
  })
}
