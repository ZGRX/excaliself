import { expect, test } from "vitest"
import { toExcalidrawFile } from "./scene-file"

const box = { id: "box", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }
const elements = [
  box,
  { ...box, id: "gone", isDeleted: true, type: "image", fileId: "old" },
  {
    id: "arrow",
    type: "arrow",
    x: 0,
    y: 0,
    points: [
      [0, 0],
      [10, 0],
    ],
    lastCommittedPoint: [10, 0],
  },
  { ...box, id: "photo", type: "image", fileId: "f1" },
]
const file = (id: string) => ({
  id,
  mimeType: "image/png",
  dataURL: "data:image/png;base64,AA==",
  created: 1,
})
const scene = {
  elements,
  appState: { viewBackgroundColor: "#fff", gridSize: 20, zoom: { value: 2 } },
  files: new Map([
    ["f1", file("f1")],
    ["old", file("old")],
  ]),
}

test("writes what Excalidraw's Save to file writes", async () => {
  // Excalidraw reads a 2d context at import time; jsdom has none.
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: () => ({ width: 0 }),
  })) as never
  const { serializeAsJSON } = await import("@excalidraw/excalidraw")
  const theirs = serializeAsJSON(
    elements as never,
    scene.appState as never,
    Object.fromEntries(scene.files) as never,
    "local",
  )
  expect(toExcalidrawFile({ ...scene, source: window.location.origin })).toBe(
    theirs,
  )
})
