// The fields the exporter draws with, read out of a stored element's untyped
// JSON with Excalidraw's defaults, so old or partial elements still render.

import { defaultLineHeight } from "./fonts"

export type Point = readonly [number, number]

export type Arrowhead =
  | "arrow"
  | "bar"
  | "dot"
  | "circle"
  | "circle_outline"
  | "triangle"
  | "triangle_outline"
  | "diamond"
  | "diamond_outline"
  | "crowfoot_one"
  | "crowfoot_many"
  | "crowfoot_one_or_many"

export type Element = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: "solid" | "dashed" | "dotted"
  roughness: number
  opacity: number
  seed: number
  roundness: { type: number; value?: number } | null
  frameId: string | null
  /** The bound text's id, from `boundElements`. */
  boundTextId: string | null
  containerId: string | null
  link: string | null
  // Lines, arrows, and freedraw.
  points: Point[]
  startArrowhead: Arrowhead | null
  endArrowhead: Arrowhead | null
  elbowed: boolean
  pressures: number[]
  simulatePressure: boolean
  // Text.
  text: string
  originalText: string
  fontSize: number
  fontFamily: number
  textAlign: string
  lineHeight: number
  // Images.
  fileId: string | null
  scale: Point
  crop: {
    x: number
    y: number
    width: number
    height: number
    naturalWidth: number
    naturalHeight: number
  } | null
  // Frames.
  name: string | null
}

const ARROWHEADS = new Set<string>([
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
])

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback
const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback
const strOrNull = (value: unknown) =>
  typeof value === "string" && value ? value : null
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const point = (value: unknown): Point | null =>
  Array.isArray(value) ? [num(value[0]), num(value[1])] : null

const arrowhead = (value: unknown, fallback: Arrowhead | null) =>
  value === undefined
    ? fallback
    : typeof value === "string" && ARROWHEADS.has(value)
      ? (value as Arrowhead)
      : null

export function readElement(raw: Record<string, unknown>): Element {
  const type = str(raw.type)
  const roundness = isObject(raw.roundness)
    ? {
        type: num(raw.roundness.type),
        value:
          typeof raw.roundness.value === "number"
            ? raw.roundness.value
            : undefined,
      }
    : null
  const boundElements = Array.isArray(raw.boundElements)
    ? raw.boundElements
    : []
  const boundText = boundElements.find(
    (bound) => isObject(bound) && bound.type === "text",
  )
  const crop = isObject(raw.crop)
    ? {
        x: num(raw.crop.x),
        y: num(raw.crop.y),
        width: num(raw.crop.width, 1),
        height: num(raw.crop.height, 1),
        naturalWidth: num(raw.crop.naturalWidth, 1),
        naturalHeight: num(raw.crop.naturalHeight, 1),
      }
    : null
  const strokeStyle = str(raw.strokeStyle)
  const text = str(raw.text)
  const fontFamily = num(raw.fontFamily, 5)
  return {
    id: str(raw.id),
    type,
    x: num(raw.x),
    y: num(raw.y),
    width: num(raw.width),
    height: num(raw.height),
    angle: num(raw.angle),
    strokeColor: str(raw.strokeColor, "#1e1e1e"),
    backgroundColor: str(raw.backgroundColor, "transparent"),
    fillStyle: str(raw.fillStyle, "solid"),
    strokeWidth: num(raw.strokeWidth, 2),
    strokeStyle:
      strokeStyle === "dashed" || strokeStyle === "dotted"
        ? strokeStyle
        : "solid",
    roughness: num(raw.roughness, 1),
    opacity: num(raw.opacity, 100),
    seed: num(raw.seed, 1),
    roundness,
    frameId: strOrNull(raw.frameId),
    boundTextId: isObject(boundText) ? strOrNull(boundText.id) : null,
    containerId: strOrNull(raw.containerId),
    link: strOrNull(raw.link),
    points: Array.isArray(raw.points)
      ? raw.points.flatMap((value) => {
          const at = point(value)
          return at ? [at] : []
        })
      : [],
    startArrowhead: arrowhead(raw.startArrowhead, null),
    endArrowhead: arrowhead(
      raw.endArrowhead,
      type === "arrow" ? "arrow" : null,
    ),
    elbowed: raw.elbowed === true,
    pressures: Array.isArray(raw.pressures)
      ? raw.pressures.map((value) => num(value, 0.5))
      : [],
    simulatePressure: raw.simulatePressure !== false,
    text,
    originalText: str(raw.originalText, text),
    fontSize: num(raw.fontSize, 20),
    fontFamily,
    textAlign: str(raw.textAlign, "left"),
    lineHeight: num(raw.lineHeight) || defaultLineHeight(fontFamily),
    fileId: strOrNull(raw.fileId),
    scale: point(raw.scale) ?? [1, 1],
    crop,
    name: strOrNull(raw.name),
  }
}
