// The simple element format an MCP client draws with. buildScene turns it
// into real Excalidraw elements: sizes, wrapped text, bindings, and a layout
// for whatever has no position.

import { z } from "zod"

export const color = z
  .string()
  .max(32)
  .describe('A hex color such as "#a5d8ff".')
export const ref = z.string().min(1).max(100)
export const coordinate = z.number().min(-100_000).max(100_000)
export const size = z.number().min(1).max(10_000)
const fontSize = z.number().min(8).max(120).describe("Default 20.")
export const strokeStyle = z.enum(["solid", "dashed", "dotted"])
// Not z.tuple: its JSON Schema ("items": false) trips some MCP clients.
const point = z.array(coordinate).length(2)
const arrowhead = z
  .enum(["arrow", "triangle", "circle", "bar", "diamond"])
  .nullable()

export const shapeSkeleton = z.object({
  type: z.enum(["rectangle", "ellipse", "diamond"]),
  id: ref.optional().describe("Your own id, for arrows to refer to."),
  x: coordinate.optional().describe("Left edge. Omit x and y to auto-layout."),
  y: coordinate.optional().describe("Top edge."),
  width: size.optional().describe("Omit to fit the label."),
  height: size.optional().describe("Omit to fit the label."),
  label: z.string().max(2000).optional().describe("Text centered inside."),
  fontSize: fontSize.optional(),
  strokeColor: color.optional(),
  backgroundColor: color.optional(),
  strokeStyle: strokeStyle.optional(),
})

export const textSkeleton = z.object({
  type: z.literal("text"),
  id: ref.optional(),
  x: coordinate.optional().describe("Omit x and y to place it above the rest."),
  y: coordinate.optional(),
  text: z.string().min(1).max(5000),
  fontSize: fontSize.optional(),
  strokeColor: color.optional(),
})

export const connectorSkeleton = z.object({
  type: z
    .enum(["arrow", "line"])
    .describe('"line" is an arrow with no arrowheads.'),
  id: ref.optional(),
  from: ref.optional().describe("Id of the shape it starts at."),
  to: ref.optional().describe("Id of the shape it ends at."),
  start: point
    .optional()
    .describe("Start point [x, y] when it is not attached to a shape."),
  end: point
    .optional()
    .describe("End point [x, y] when it is not attached to a shape."),
  label: z.string().max(500).optional(),
  fontSize: fontSize.optional(),
  strokeColor: color.optional(),
  strokeStyle: strokeStyle.optional(),
  strokeWidth: z.number().min(1).max(8).optional().describe("Default 2."),
  startArrowhead: arrowhead.optional().describe("Default none."),
  endArrowhead: arrowhead
    .optional()
    .describe('Default "arrow" for arrows, none for lines.'),
})

export const elementSkeleton = z.discriminatedUnion("type", [
  shapeSkeleton,
  textSkeleton,
  connectorSkeleton,
])

export type ShapeSkeleton = z.infer<typeof shapeSkeleton>
export type TextSkeleton = z.infer<typeof textSkeleton>
export type ConnectorSkeleton = z.infer<typeof connectorSkeleton>
export type ElementSkeleton = z.infer<typeof elementSkeleton>

/** Most elements one scene may have, Mermaid nodes and edges included. */
export const MAX_ELEMENTS = 500

/** The input can't be drawn; the message says why, for the client to fix. */
export class SceneInputError extends Error {}

export const directions = ["TB", "BT", "LR", "RL"] as const
export type Direction = (typeof directions)[number]

/**
 * A titled box around shapes, from a Mermaid subgraph. In a SceneGraph a
 * parent comes before its children, so outer boxes draw behind inner ones.
 */
export type Cluster = {
  id: string
  label: string
  parent: string | null
  /** Ids of the shapes directly inside. */
  members: string[]
}

export type SceneGraph = {
  elements: ElementSkeleton[]
  clusters: Cluster[]
  /** Flow of the auto-layout. */
  direction: Direction
}
