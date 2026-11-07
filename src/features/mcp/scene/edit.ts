// edit_drawing's planner: turns adds, changes, and removals into the new
// version of every element they touch, checked against the current scene.
// It writes nothing. The member's own tab applies the plan (ADR 0003).

import { randomInt } from "node:crypto"
import { z } from "zod"
import type { SceneElement } from "@/features/collab/protocol"
import type { Revision } from "@/features/drawing-edits/apply"
import { buildScene, cleanText, containerSize } from "./build"
import {
  arrowLabel,
  boundText,
  center,
  type Label,
  outlinePoint,
  type ShapeType,
  type Target,
  textSpace,
} from "./elements"
import { type Box, type Point, union } from "./layout"
import {
  color,
  coordinate,
  type ElementSkeleton,
  ref,
  SceneInputError,
  size,
  strokeStyle,
} from "./skeleton"
import { FONT_SIZE, measureText, wrapText } from "./text"

export const elementChange = z.object({
  id: ref.describe("An element id from read_drawing."),
  label: z
    .string()
    .max(2000)
    .optional()
    .describe('New label of a shape or arrow. "" removes it.'),
  text: z
    .string()
    .min(1)
    .max(5000)
    .optional()
    .describe("New text of a text element."),
  x: coordinate
    .optional()
    .describe("Moves a shape or text: new left edge. Leave out to keep it."),
  y: coordinate.optional().describe("New top edge. Leave out to keep it."),
  width: size.optional().describe("Resizes a shape."),
  height: size.optional(),
  strokeColor: color.optional(),
  backgroundColor: color.optional().describe("Shapes only."),
  strokeStyle: strokeStyle.optional().describe("Shapes and connectors."),
})

export type ElementChange = z.infer<typeof elementChange>

export type EditInput = {
  add: ElementSkeleton[]
  change: ElementChange[]
  remove: string[]
}

export type EditPlan = {
  /** Every new and changed element, whole, with its version bumped. */
  elements: SceneElement[]
  /** Element id → the revision this plan was made on, for the stale check. */
  base: Record<string, Revision>
  /** One line per change, for the member to read. */
  changes: string[]
}

type Kind = "shape" | "text" | "connector"

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"])
const FIELDS: Record<Kind, (keyof ElementChange)[]> = {
  shape: [
    "label",
    "x",
    "y",
    "width",
    "height",
    "strokeColor",
    "backgroundColor",
    "strokeStyle",
  ],
  text: ["text", "x", "y", "strokeColor"],
  connector: ["label", "strokeColor", "strokeStyle"],
}

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" ? value : fallback
const str = (value: unknown) => (typeof value === "string" ? value : "")

function kindOf(element: SceneElement): Kind | null {
  const type = str(element.type)
  if (SHAPE_TYPES.has(type)) return "shape"
  if (type === "text") return "text"
  if (type === "arrow" || type === "line") return "connector"
  return null
}

const boxOf = (element: SceneElement): Box => ({
  x: num(element.x),
  y: num(element.y),
  width: Math.abs(num(element.width)),
  height: Math.abs(num(element.height)),
})

/** Binds and draws like its own type; anything else, like a rectangle. */
const targetOf = (element: SceneElement): Target => ({
  id: element.id,
  type: (SHAPE_TYPES.has(str(element.type))
    ? element.type
    : "rectangle") as ShapeType,
  box: boxOf(element),
})

const boundIdOf = (binding: unknown) =>
  binding && typeof binding === "object" && "elementId" in binding
    ? str(binding.elementId)
    : ""

type BoundRef = { id: string; type: string }
const boundElementsOf = (element: SceneElement): BoundRef[] =>
  Array.isArray(element.boundElements)
    ? (element.boundElements as BoundRef[])
    : []

const pointsOf = (element: SceneElement): Point[] =>
  (Array.isArray(element.points) ? (element.points as Point[]) : []).map(
    ([dx, dy]): Point => [num(element.x) + dx, num(element.y) + dy],
  )

const quote = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return JSON.stringify(flat.length > 40 ? `${flat.slice(0, 40)}…` : flat)
}

/** Names elements for the change list, from one view of the scene. */
function namer(scene: Map<string, SceneElement>) {
  const labels = new Map<string, string>()
  for (const element of scene.values()) {
    const container = str(element.containerId)
    if (container && !element.isDeleted)
      labels.set(container, str(element.originalText) || str(element.text))
  }
  const short = (id: string) => {
    const element = scene.get(id)
    if (!element) return "a point"
    const label = labels.get(id)
    return label ? quote(label) : str(element.type)
  }
  return (element: SceneElement) => {
    const type = str(element.type)
    if (type === "text")
      return `text ${quote(str(element.originalText) || str(element.text))}`
    if (type === "arrow" || type === "line") {
      const label = labels.get(element.id)
      const from = short(boundIdOf(element.startBinding))
      const to = short(boundIdOf(element.endBinding))
      return `${type} ${from} → ${to}${label ? ` (${quote(label)})` : ""}`
    }
    const label = labels.get(element.id)
    return label ? `${type} ${quote(label)}` : type
  }
}

/** Plans an edit. Throws SceneInputError listing every problem in it. */
export function planEdit(
  scene: readonly SceneElement[],
  input: EditInput,
): EditPlan {
  const live = new Map(
    scene.filter((element) => !element.isDeleted).map((el) => [el.id, el]),
  )
  /** Container id → its bound text. */
  const labels = new Map<string, SceneElement>()
  for (const element of live.values()) {
    const container = str(element.containerId)
    if (container && live.has(container)) labels.set(container, element)
  }
  const describeBefore = namer(live)
  const errors: string[] = []

  const isLabel = (element: SceneElement) => live.has(str(element.containerId))

  const removed = new Set<string>()
  input.remove.forEach((id, index) => {
    const element = live.get(id)
    if (!element) errors.push(`remove[${index}]: no element has id "${id}".`)
    else if (isLabel(element))
      errors.push(
        `remove[${index}]: "${id}" is a label; set its element's label to "" instead.`,
      )
    else removed.add(id)
  })

  const changed = new Set<string>()
  input.change.forEach((change, index) => {
    const where = `change[${index}]`
    const element = live.get(change.id)
    if (!element) {
      errors.push(`${where}: no element has id "${change.id}".`)
      return
    }
    if (changed.has(change.id))
      errors.push(`${where}: "${change.id}" is changed twice.`)
    changed.add(change.id)
    if (removed.has(change.id))
      errors.push(`${where}: "${change.id}" is also removed.`)
    if (isLabel(element)) {
      errors.push(
        `${where}: "${change.id}" is a label; change its element's label instead.`,
      )
      return
    }
    const kind = kindOf(element)
    if (!kind) {
      errors.push(`${where}: a ${str(element.type)} can only be removed.`)
      return
    }
    const given = (Object.keys(change) as (keyof ElementChange)[]).filter(
      (key) => key !== "id" && change[key] !== undefined,
    )
    if (given.length === 0) errors.push(`${where}: nothing to change.`)
    for (const key of given)
      if (!FIELDS[kind].includes(key))
        errors.push(`${where}: "${key}" doesn't apply to a ${element.type}.`)
    if (change.label !== undefined && element.type === "line")
      errors.push(`${where}: a line can't have a label.`)
  })
  if (errors.length > 0) throw new SceneInputError(errors.join("\n"))

  const next = new Map<string, SceneElement>()
  const base: Record<string, Revision> = {}
  const created: SceneElement[] = []
  const lines: string[] = []

  /** The working copy of an existing element, bumped once however often it changes. */
  const touch = (id: string): SceneElement => {
    const existing = next.get(id)
    if (existing) return existing
    const current = live.get(id) as SceneElement
    const copy: SceneElement = {
      ...current,
      version: current.version + 1,
      versionNonce: randomInt(1, 2 ** 31),
      updated: Date.now(),
    }
    next.set(id, copy)
    base[id] = { version: current.version, versionNonce: current.versionNonce }
    return copy
  }
  const read = (id: string) => next.get(id) ?? live.get(id)
  const unbind = (container: string, id: string) => {
    const element = touch(container)
    element.boundElements = boundElementsOf(element).filter(
      (bound) => bound.id !== id,
    )
  }

  // A label's text follows its container: re-placed, re-written, or gone.
  const setLabel = (
    container: SceneElement,
    original: string | null,
    place: (label: Label, strokeColor: string) => SceneElement,
  ) => {
    // The label as this plan has it so far: new, changed, or gone.
    const text = labels.get(container.id)
    const working = text && (next.get(text.id) ?? text)
    const strokeColor = str(container.strokeColor) || "#1e1e1e"
    if (original === "") {
      if (!text) return
      labels.delete(container.id)
      touch(text.id).isDeleted = true
      unbind(container.id, text.id)
      return
    }
    if (!working && original === null) return
    const fontSize = num(working?.fontSize, FONT_SIZE)
    const label: Label = {
      text: original ?? str(working?.text),
      original: original ?? str(working?.originalText),
      fontSize,
    }
    const placed = place(label, strokeColor)
    if (!text) {
      created.push(placed)
      labels.set(container.id, placed)
      container.boundElements = [
        ...boundElementsOf(container),
        { id: placed.id, type: "text" },
      ]
      return
    }
    Object.assign(live.has(text.id) ? touch(text.id) : text, {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      text: placed.text,
      originalText: placed.originalText,
      strokeColor,
    })
  }

  const shapeLabel =
    (shape: SceneElement) => (label: Label, stroke: string) => {
      const target = targetOf(shape)
      const text = wrapText(
        label.original,
        label.fontSize,
        textSpace(target.type, target.box.width),
      )
      return boundText(target, { ...label, text }, stroke) as SceneElement
    }
  const connectorLabel =
    (connector: SceneElement) => (label: Label, stroke: string) =>
      arrowLabel(
        connector.id,
        pointsOf(connector),
        Math.abs(num(connector.width)),
        label,
        stroke,
      ) as SceneElement

  for (const id of removed) {
    const element = touch(id)
    lines.push(`Remove ${describeBefore(live.get(id) as SceneElement)}`)
    element.isDeleted = true
    const text = labels.get(id)
    if (text) touch(text.id).isDeleted = true
    for (const binding of [element.startBinding, element.endBinding]) {
      const shape = boundIdOf(binding)
      if (live.has(shape) && !removed.has(shape)) unbind(shape, id)
    }
  }
  // Arrows outlive a removed shape, unbound, as in the editor.
  for (const arrow of live.values()) {
    if (removed.has(arrow.id)) continue
    const start = removed.has(boundIdOf(arrow.startBinding))
    const end = removed.has(boundIdOf(arrow.endBinding))
    if (start) touch(arrow.id).startBinding = null
    if (end) touch(arrow.id).endBinding = null
  }

  const moved = new Set<string>()
  for (const change of input.change) {
    const original = live.get(change.id) as SceneElement
    const element = touch(change.id)
    const what: string[] = []
    if (change.strokeColor !== undefined)
      element.strokeColor = change.strokeColor
    if (change.backgroundColor !== undefined)
      element.backgroundColor = change.backgroundColor
    if (change.strokeStyle !== undefined)
      element.strokeStyle = change.strokeStyle
    if (
      change.strokeColor !== undefined ||
      change.backgroundColor !== undefined
    )
      what.push("color")
    if (change.strokeStyle !== undefined) what.push("line style")
    if (change.x !== undefined || change.y !== undefined) {
      element.x = change.x ?? element.x
      element.y = change.y ?? element.y
      what.push("position")
    }
    const label =
      change.label === undefined ? null : cleanText(change.label) || ""
    if (change.label !== undefined) what.push("label")

    switch (kindOf(original)) {
      case "shape": {
        if (change.width !== undefined) element.width = change.width
        if (change.height !== undefined) element.height = change.height
        if (change.width !== undefined || change.height !== undefined)
          what.push("size")
        // A label that no longer fits grows the shape, as in create_drawing.
        const text = label ?? str(labels.get(element.id)?.originalText)
        if (text) {
          const type = targetOf(element).type
          const fontSize = num(labels.get(element.id)?.fontSize, FONT_SIZE)
          const wrapped = wrapText(
            text,
            fontSize,
            textSpace(type, num(element.width)),
          )
          const needed = containerSize(
            type,
            measureText(wrapped, fontSize).height,
          )
          if (needed > num(element.height)) element.height = needed
        }
        const geometry =
          what.includes("position") ||
          what.includes("size") ||
          num(element.height) !== num(original.height)
        if (geometry) moved.add(element.id)
        if (label !== null || geometry || change.strokeColor !== undefined)
          setLabel(element, label, shapeLabel(element))
        break
      }
      case "text": {
        if (change.text !== undefined) {
          const text = cleanText(change.text)
          const fontSize = num(element.fontSize, FONT_SIZE)
          const wrapped =
            element.autoResize === false
              ? wrapText(text, fontSize, num(element.width))
              : text
          const measured = measureText(wrapped, fontSize)
          Object.assign(element, {
            text: wrapped,
            originalText: text,
            height: measured.height,
            ...(element.autoResize === false ? {} : { width: measured.width }),
          })
          what.push("text")
        }
        break
      }
      case "connector":
        if (label !== null || change.strokeColor !== undefined)
          setLabel(element, label, connectorLabel(element))
        break
    }
    lines.push(`Change ${describeBefore(original)}: ${what.join(", ")}`)
  }

  // Arrows bound to a moved shape follow it, straight from outline to outline.
  for (const arrow of live.values()) {
    if (removed.has(arrow.id) || str(arrow.type) !== "arrow") continue
    const current = read(arrow.id) as SceneElement
    const startId = boundIdOf(current.startBinding)
    const endId = boundIdOf(current.endBinding)
    if (!moved.has(startId) && !moved.has(endId)) continue
    // A loop on one shape keeps its form and moves along with it.
    if (startId === endId) {
      const before = boxOf(live.get(startId) as SceneElement)
      const after = boxOf(read(startId) as SceneElement)
      const element = touch(arrow.id)
      element.x = num(element.x) + after.x - before.x
      element.y = num(element.y) + after.y - before.y
      setLabel(element, null, connectorLabel(element))
      continue
    }
    const points = pointsOf(current)
    const start = live.has(startId)
      ? targetOf(read(startId) as SceneElement)
      : null
    const end = live.has(endId) ? targetOf(read(endId) as SceneElement) : null
    const startAt = start ? center(start) : (points[0] ?? [0, 0])
    const endAt = end ? center(end) : (points.at(-1) ?? [0, 0])
    const from = start ? outlinePoint(start, endAt) : startAt
    const to = end ? outlinePoint(end, startAt) : endAt
    const element = touch(arrow.id)
    Object.assign(element, {
      x: from[0],
      y: from[1],
      width: Math.abs(to[0] - from[0]),
      height: Math.abs(to[1] - from[1]),
      points: [
        [0, 0],
        [to[0] - from[0], to[1] - from[1]],
      ],
    })
    setLabel(element, null, connectorLabel(element))
  }

  // Added last, so new arrows join shapes where they now are.
  const targets = new Map<string, Target>()
  let bounds: Box | null = null
  for (const id of live.keys()) {
    if (removed.has(id)) continue
    const element = read(id) as SceneElement
    const box = boxOf(element)
    bounds = bounds ? union(bounds, box) : box
    if (kindOf(element) === "shape") targets.set(id, targetOf(element))
  }
  let built: SceneElement[] = []
  try {
    built = buildScene(
      { elements: input.add, clusters: [], direction: "TB" },
      { targets, bounds },
    ).map((element) => ({ ...element, index: null }))
  } catch (error) {
    if (!(error instanceof SceneInputError)) throw error
    throw new SceneInputError(error.message.replace(/^elements\[/gm, "add["))
  }
  for (const element of built) {
    for (const binding of [element.startBinding, element.endBinding]) {
      const shape = boundIdOf(binding)
      if (!live.has(shape)) continue
      const target = touch(shape)
      target.boundElements = [
        ...boundElementsOf(target),
        { id: element.id, type: "arrow" },
      ]
    }
  }

  const after = new Map(live)
  for (const element of [...next.values(), ...created, ...built])
    after.set(element.id, element)
  const describeAfter = namer(after)
  for (const element of built)
    if (!str(element.containerId)) lines.push(`Add ${describeAfter(element)}`)

  // Tabs place new elements on top; null tells Excalidraw to index them.
  const elements = [...next.values(), ...created, ...built].map((element) =>
    next.has(element.id) ? element : { ...element, index: null },
  )
  return { elements, base, changes: lines }
}
