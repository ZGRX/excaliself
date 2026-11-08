// @vitest-environment node
import { expect, test } from "vitest"
import { parseImportedScene } from "./import"
import { SceneInputError } from "./skeleton"

const PNG = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`

const rect = (extra: Record<string, unknown> = {}) => ({
  type: "rectangle",
  id: "r1",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  version: 7,
  versionNonce: 42,
  ...extra,
})

const file = (elements: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: { viewBackgroundColor: "#fff", zoom: { value: 3 } },
    files: {},
    ...extra,
  })

const errorOf = (json: string) => {
  try {
    parseImportedScene(json)
  } catch (error) {
    expect(error).toBeInstanceOf(SceneInputError)
    return (error as Error).message
  }
  throw new Error("expected a SceneInputError")
}

test("keeps a saved file's elements, ids, and versions, and indexes them in order", () => {
  const { content } = parseImportedScene(
    file([
      rect({ index: "zz" }),
      {
        type: "text",
        id: "t1",
        x: 5,
        y: 5,
        text: "Hi",
        version: 2,
        index: "a0",
      },
    ]),
  )
  expect(content.elements).toMatchObject([
    { id: "r1", version: 7, versionNonce: 42, index: "c000" },
    { id: "t1", text: "Hi", index: "c001" },
  ])
  // Only what "Save to file" keeps.
  expect(content.appState).toEqual({ viewBackgroundColor: "#fff" })
})

test("replaces bad and repeated ids and bad versions, and drops deleted elements", () => {
  const { content } = parseImportedScene(
    file([
      rect({ version: Number.MAX_SAFE_INTEGER, versionNonce: "x" }),
      rect({ x: 10, versionNonce: -5 }),
      rect({ id: 5 }),
      rect({ id: "gone", isDeleted: true }),
    ]),
  )
  const [first, second, third] = content.elements
  expect(content.elements).toHaveLength(3)
  expect(first).toMatchObject({ id: "r1", version: 1, versionNonce: 0 })
  expect(second.id).not.toBe("r1")
  expect(second.versionNonce).toBe(0)
  expect(typeof third.id).toBe("string")
  expect(third.id).not.toBe(second.id)
})

test("names each element problem by its place in the scene", () => {
  expect(errorOf("{nope")).toBe("The scene is not valid JSON.")
  expect(errorOf(file([rect(), { type: "blob", x: 0, y: 0 }]))).toMatch(
    /^elements\[1\]\.type: Unknown element type/,
  )
  expect(
    errorOf(file([{ type: "arrow", id: "a", x: 0, y: 0, points: "far" }])),
  ).toMatch(/^elements\[0\]\.points: /)
  expect(errorOf(file([rect({ x: "1" })]))).toMatch(/^elements\[0\]\.x: /)
  // The Room refuses elements nested deeper than 64 levels.
  let deep: unknown = 1
  for (let i = 0; i < 70; i++) deep = { deep }
  expect(errorOf(file([rect(), rect({ customData: deep })]))).toBe(
    "elements[1]: nested more than 64 levels deep.",
  )
  // Restore reads points.length and fixedSegments.map() as they are.
  expect(errorOf(file([{ type: "line", id: "l", x: 0, y: 0 }]))).toMatch(
    /^elements\[0\]\.points: /,
  )
  expect(
    errorOf(
      file([
        { type: "arrow", id: "a", x: 0, y: 0, points: [], fixedSegments: "x" },
      ]),
    ),
  ).toMatch(/^elements\[0\]\.fixedSegments: /)
  expect(errorOf(JSON.stringify({ type: "excalidrawlib", elements: [] }))).toBe(
    'type: Not a .excalidraw scene: "type" must be "excalidraw".',
  )
})

test("stores used images, rejects bad ones, and counts missing ones", () => {
  const image = (fileId: string) => ({
    type: "image",
    id: `img-${fileId}`,
    x: 0,
    y: 0,
    fileId,
    status: "saved",
  })
  const files = {
    ok: { mimeType: "image/png", id: "ok", dataURL: PNG },
    unused: { dataURL: PNG },
  }
  const { content, missingImages } = parseImportedScene(
    file([image("ok"), image("missing")], { files }),
  )
  expect(Object.keys(content.files)).toEqual(["ok"])
  expect(missingImages).toBe(1)

  expect(
    errorOf(
      file([image("bad")], {
        files: { bad: { dataURL: "data:text/html;base64,PGI+" } },
      }),
    ),
  ).toMatch(/^files\["bad"\]: needs a "dataURL"/)
})

test("takes the scene as an object too", () => {
  const json = file([rect()])
  expect(parseImportedScene(JSON.parse(json))).toEqual(parseImportedScene(json))
})
