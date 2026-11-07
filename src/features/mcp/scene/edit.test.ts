import { expect, test } from "vitest"
import type { SceneElement } from "@/features/collab/protocol"
import { buildScene } from "./build"
import { type EditInput, planEdit } from "./edit"
import { SceneInputError } from "./skeleton"

type Point = [number, number]

// Client → API, labeled, with free text: the drawing an edit starts from.
function drawing() {
  const elements = buildScene({
    elements: [
      { type: "rectangle", id: "client", label: "Client", x: 0, y: 0 },
      { type: "rectangle", id: "api", label: "API", x: 400, y: 0 },
      { type: "arrow", from: "client", to: "api", label: "HTTPS" },
      { type: "text", text: "Notes", x: 0, y: 200 },
    ],
    clusters: [],
    direction: "TB",
  })
  const textOf = (text: string) =>
    elements.find((element) => element.originalText === text) as SceneElement
  const labeled = (text: string) =>
    byId(elements, textOf(text).containerId as string)
  return {
    elements,
    client: labeled("Client"),
    api: labeled("API"),
    arrow: labeled("HTTPS"),
    notes: textOf("Notes"),
    labelOf: (id: string) =>
      elements.find((element) => element.containerId === id) as SceneElement,
  }
}

const plan = (scene: SceneElement[], input: Partial<EditInput>) =>
  planEdit(scene, { add: [], change: [], remove: [], ...input })

const byId = (elements: SceneElement[], id: string) =>
  elements.find((element) => element.id === id) as SceneElement

const boundIds = (element: SceneElement) =>
  (element.boundElements as { id: string }[]).map(({ id }) => id)

function endpoints(arrow: SceneElement): [Point, Point] {
  const points = arrow.points as Point[]
  const x = arrow.x as number
  const y = arrow.y as number
  const [lastX, lastY] = points[points.length - 1]
  return [
    [x + points[0][0], y + points[0][1]],
    [x + lastX, y + lastY],
  ]
}

test("puts a CDN between two shapes: remove one arrow, add a shape and two", () => {
  const { elements, client, api, arrow, labelOf } = drawing()
  const result = plan(elements, {
    remove: [arrow.id],
    add: [
      { type: "rectangle", id: "cdn", label: "CDN", x: 200, y: 0 },
      { type: "arrow", from: client.id, to: "cdn" },
      { type: "arrow", from: "cdn", to: api.id },
    ],
  })

  // The old arrow and its label go; the shapes forget it.
  expect(byId(result.elements, arrow.id).isDeleted).toBe(true)
  expect(byId(result.elements, labelOf(arrow.id).id).isDeleted).toBe(true)
  const added = result.elements.filter(
    (element) => !(element.id in result.base),
  )
  const [toCdn, fromCdn] = added.filter((element) => element.type === "arrow")
  expect(boundIds(byId(result.elements, client.id))).toEqual([
    labelOf(client.id).id,
    toCdn.id,
  ])
  expect(boundIds(byId(result.elements, api.id))).toEqual([
    labelOf(api.id).id,
    fromCdn.id,
  ])
  expect(toCdn.startBinding).toMatchObject({ elementId: client.id })
  expect(fromCdn.endBinding).toMatchObject({ elementId: api.id })

  // Each touched element is bumped once, from the version it was planned on.
  for (const element of result.elements) {
    const before = elements.find((old) => old.id === element.id)
    if (before) {
      expect(result.base[element.id]).toEqual({
        version: before.version,
        versionNonce: before.versionNonce,
      })
      expect(element.version).toBe(before.version + 1)
    } else {
      expect(element.index).toBeNull()
    }
  }
  expect(result.changes).toEqual([
    'Remove arrow "Client" → "API" ("HTTPS")',
    'Add rectangle "CDN"',
    'Add arrow "Client" → "CDN"',
    'Add arrow "CDN" → "API"',
  ])
})

test("a moved shape takes its label and the arrows bound to it along", () => {
  const { elements, api, arrow, labelOf } = drawing()
  const result = plan(elements, { change: [{ id: api.id, x: 700, y: 300 }] })

  const moved = byId(result.elements, api.id)
  const label = byId(result.elements, labelOf(api.id).id)
  const center = (element: SceneElement): Point => [
    (element.x as number) + (element.width as number) / 2,
    (element.y as number) + (element.height as number) / 2,
  ]
  expect(center(label)[0]).toBeCloseTo(center(moved)[0], 0)
  expect(center(label)[1]).toBeCloseTo(center(moved)[1], 0)

  // The arrow now ends just outside the moved box, at its new place.
  const [, end] = endpoints(byId(result.elements, arrow.id))
  expect(end[0]).toBeGreaterThan(690)
  expect(end[1]).toBeGreaterThan(290)
  expect(result.changes).toEqual(['Change rectangle "API": position'])
})

test("a loop on a moved shape moves with it, keeping its form", () => {
  const scene = buildScene({
    elements: [
      { type: "rectangle", id: "box", x: 0, y: 0 },
      { type: "arrow", from: "box", to: "box" },
    ],
    clusters: [],
    direction: "TB",
  })
  const box = scene.find((element) => element.type === "rectangle")
  const loop = scene.find((element) => element.type === "arrow")
  if (!box || !loop) throw new Error("scene not built")
  const result = plan(scene, { change: [{ id: box.id, x: 300, y: 200 }] })

  const moved = byId(result.elements, loop.id)
  expect(moved.x).toBe(loop.x + 300)
  expect(moved.y).toBe(loop.y + 200)
  expect(moved.points).toEqual(loop.points)
})

test("a longer label grows the shape; an empty one removes the label", () => {
  const { elements, client, api, labelOf } = drawing()
  const long = "API gateway with rate limits, auth, and request logging"
  const result = plan(elements, {
    change: [
      { id: api.id, label: long },
      { id: client.id, label: "" },
    ],
  })

  const grown = byId(result.elements, api.id)
  expect(grown.height).toBeGreaterThan(api.height as number)
  expect(byId(result.elements, labelOf(api.id).id).originalText).toBe(long)
  expect(byId(result.elements, labelOf(client.id).id).isDeleted).toBe(true)
  expect(boundIds(byId(result.elements, client.id))).not.toContain(
    labelOf(client.id).id,
  )
})

test("an arrow relabeled while its shape moves keeps the new label", () => {
  const { elements, api, arrow, labelOf } = drawing()
  const result = plan(elements, {
    change: [
      { id: api.id, x: 700 },
      { id: arrow.id, label: "gRPC" },
    ],
  })
  const label = byId(result.elements, labelOf(arrow.id).id)
  expect(label.originalText).toBe("gRPC")
  // Re-placed on the rerouted arrow, not where the old one ran.
  expect(label.x as number).toBeGreaterThan(300)
})

test("a shape with no label gets one, bound both ways", () => {
  const [box] = buildScene({
    elements: [{ type: "rectangle", x: 0, y: 0 }],
    clusters: [],
    direction: "TB",
  })
  const result = plan([box], { change: [{ id: box.id, label: "Cache" }] })
  const text = result.elements.find((element) => element.type === "text")
  expect(text).toMatchObject({ containerId: box.id, originalText: "Cache" })
  expect(boundIds(byId(result.elements, box.id))).toEqual([text?.id])
})

test("lists every problem at once", () => {
  const { elements, api, notes, labelOf } = drawing()
  const attempt = () =>
    plan(elements, {
      remove: ["nope", labelOf(api.id).id],
      change: [{ id: notes.id, backgroundColor: "#ffc9c9" }, { id: api.id }],
      add: [{ type: "arrow", from: "missing", to: api.id }],
    })
  expect(attempt).toThrow(SceneInputError)
  expect(attempt).toThrow(
    [
      'remove[0]: no element has id "nope".',
      `remove[1]: "${labelOf(api.id).id}" is a label; set its element's label to "" instead.`,
      'change[0]: "backgroundColor" doesn\'t apply to a text.',
      "change[1]: nothing to change.",
    ].join("\n"),
  )
})

test("an add that names a missing shape says where", () => {
  const { elements, api } = drawing()
  expect(() =>
    plan(elements, { add: [{ type: "arrow", from: "missing", to: api.id }] }),
  ).toThrow('add[0].from: no shape has id "missing".')
})
