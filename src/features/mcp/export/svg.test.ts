import { expect, test } from "vitest"
import { type ExportOptions, renderSvg } from "./svg"

const base = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  angle: 0,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  link: null,
  locked: false,
  roundness: null,
}

const text = (fields: Record<string, unknown>) => ({
  ...base,
  type: "text",
  width: 100,
  height: 25,
  fontSize: 20,
  fontFamily: 5,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  lineHeight: 1.25,
  originalText: fields.text,
  ...fields,
})

// One of each element kind and style the renderer ports.
const scene = [
  {
    ...base,
    id: "box",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    backgroundColor: "#a5d8ff",
    fillStyle: "hachure",
    roundness: { type: 3 },
    seed: 11,
    boundElements: [{ id: "boxText", type: "text" }],
  },
  text({
    id: "boxText",
    x: 50,
    y: 37.5,
    text: "Hello world",
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "box",
    seed: 12,
  }),
  {
    ...base,
    id: "diamond",
    type: "diamond",
    x: 300,
    y: 0,
    width: 140,
    height: 100,
    backgroundColor: "#ffc9c9",
    fillStyle: "cross-hatch",
    roundness: { type: 2 },
    seed: 13,
    strokeStyle: "dashed",
    angle: 0.3,
  },
  {
    ...base,
    id: "ellipse",
    type: "ellipse",
    x: 500,
    y: 0,
    width: 120,
    height: 80,
    backgroundColor: "#b2f2bb",
    seed: 14,
    strokeStyle: "dotted",
    opacity: 60,
  },
  {
    ...base,
    id: "curve",
    type: "arrow",
    x: 200,
    y: 50,
    width: 100,
    height: 60,
    points: [
      [0, 0],
      [50, 60],
      [100, 0],
    ],
    seed: 15,
    roundness: { type: 2 },
    startArrowhead: "dot",
    endArrowhead: "triangle",
    boundElements: [{ id: "curveText", type: "text" }],
  },
  text({
    id: "curveText",
    x: 230,
    y: 97.5,
    width: 40,
    text: "go",
    fontFamily: 6,
    lineHeight: 1.35,
    textAlign: "center",
    containerId: "curve",
    seed: 16,
  }),
  {
    ...base,
    id: "dotted",
    type: "arrow",
    x: 0,
    y: 200,
    width: 300,
    height: 0,
    points: [
      [0, 0],
      [300, 0],
    ],
    seed: 17,
    startArrowhead: "diamond_outline",
    endArrowhead: "crowfoot_one_or_many",
    strokeStyle: "dotted",
  },
  {
    ...base,
    id: "elbow",
    type: "arrow",
    x: 0,
    y: 260,
    width: 300,
    height: 100,
    points: [
      [0, 0],
      [150, 0],
      [150, 100],
      [300, 100],
    ],
    seed: 18,
    elbowed: true,
    startArrowhead: null,
    endArrowhead: "arrow",
  },
  {
    ...base,
    id: "loop",
    type: "line",
    x: 400,
    y: 200,
    width: 100,
    height: 100,
    points: [
      [0, 0],
      [100, 0],
      [50, 100],
      [0, 0],
    ],
    seed: 19,
    backgroundColor: "#ffec99",
    fillStyle: "zigzag",
  },
  {
    ...base,
    id: "pen",
    type: "freedraw",
    x: 550,
    y: 200,
    width: 100,
    height: 50,
    points: [
      [0, 0],
      [20, 10],
      [40, 30],
      [60, 35],
      [100, 50],
    ],
    pressures: [],
    simulatePressure: true,
    seed: 20,
    lastCommittedPoint: null,
  },
  text({
    id: "note",
    x: 0,
    y: 400,
    width: 300,
    height: 50,
    text: "Two lines\nof text",
    seed: 21,
    angle: -0.2,
  }),
  {
    ...base,
    id: "frame",
    type: "frame",
    x: 700,
    y: 0,
    width: 200,
    height: 150,
    name: "My frame",
    seed: 30,
  },
  {
    ...base,
    id: "inFrame",
    type: "rectangle",
    x: 750,
    y: 100,
    width: 200,
    height: 100,
    frameId: "frame",
    seed: 31,
    backgroundColor: "#d0bfff",
  },
  {
    ...base,
    id: "image",
    type: "image",
    x: 700,
    y: 300,
    width: 80,
    height: 40,
    fileId: "file1",
    status: "saved",
    scale: [1, 1],
    crop: null,
    seed: 32,
    roundness: { type: 3 },
  },
]
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const options: ExportOptions = {
  darkMode: false,
  background: true,
  backgroundColor: "#ffffff",
  padding: 10,
  scale: 1,
  target: "svg",
}

test("draws a scene as Excalidraw's own SVG export does", async () => {
  // Excalidraw needs a 2d context, Path2D, and FontFace; jsdom has none.
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: () => ({ width: 0 }),
  })) as never
  Object.assign(globalThis, {
    Path2D: class {},
    FontFace: class {
      constructor(public family: string) {}
    },
  })
  const { exportToSvg } = await import("@excalidraw/excalidraw")
  const theirs = await exportToSvg({
    elements: scene as never,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    files: {
      file1: { id: "file1", mimeType: "image/png", dataURL: PNG, created: 1 },
    } as never,
    skipInliningFonts: true,
  })
  const mine = await renderSvg(
    scene,
    new Map([["file1", { mimeType: "image/png", dataURL: PNG }]]),
    options,
  )

  // Same drawing, apart from deliberate differences: where <defs> and clip
  // paths go (and their ids), fonts, empty masks, and the pivot of unrotated
  // elements, which moves nothing.
  const normalize = (svg: string) =>
    svg
      .replace(
        /<metadata><\/metadata>|<mask><\/mask>|<defs>[\s\S]*?<\/defs>|<clipPath[\s\S]*?<\/clipPath>/g,
        "",
      )
      .replace(/clip-path="url\(#(clip-)?/g, 'clip-path="url(#')
      .replace(/rotate\(0 [^)]*\)/g, "rotate(0)")
      .replace(/\d+\.\d+/g, (n) => Number(n).toFixed(3))
      .split(/(?=<)/)
  expect(normalize(mine?.svg ?? "")).toEqual(normalize(theirs.outerHTML))
})

test("embeds the fonts its text uses, CJK fallback first", async () => {
  const result = await renderSvg(
    [
      text({ id: "a", x: 0, y: 0, text: "Hi ą 漢" }),
      text({ id: "b", x: 0, y: 50, text: "Frame-like", fontFamily: 2 }),
    ],
    new Map(),
    options,
  )
  const faces = [
    ...(result?.svg ?? "").matchAll(
      /font-family: "([^"]+)"; src: url\(data:font\/woff2;base64,[^)]+\); unicode-range: ([^;]+);/g,
    ),
  ].map(([, family, range]) => `${family} ${range}`)
  // Helvetica is left to the system; each character comes from one file.
  expect(faces).toEqual([
    "Xiaolai U+6f22",
    "Excalifont U+20,U+48,U+69",
    "Excalifont U+105",
  ])
})

test("a PNG gets the font of an embed's placeholder label", async () => {
  const result = await renderSvg(
    [{ id: "embed", type: "embeddable", x: 0, y: 0, width: 300, height: 150 }],
    new Map(),
    { ...options, target: "png" },
  )
  expect(result?.fontFiles).toEqual(["Liberation/LiberationSans-Regular.woff2"])
})

test("a cropped, rounded image is clipped over its visible part", async () => {
  const result = await renderSvg(
    [
      {
        id: "photo",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        fileId: "file1",
        roundness: { type: 3 },
        crop: {
          x: 40,
          y: 20,
          width: 100,
          height: 50,
          naturalWidth: 200,
          naturalHeight: 100,
        },
      },
    ],
    new Map([["file1", { mimeType: "image/png", dataURL: PNG }]]),
    options,
  )
  // The rounded clip and the crop mask cover the same rectangle.
  const mask = result?.svg.match(
    /<mask id="mask-image-crop-photo"[^>]*><rect x="(\d+)" y="(\d+)"/,
  )
  const clip = result?.svg.match(
    /<clipPath id="image-clipPath-photo"><rect x="(\d+)" y="(\d+)"/,
  )
  expect(mask?.slice(1)).toEqual(["40", "20"])
  expect(clip?.slice(1)).toEqual(mask?.slice(1))
})

test("an embed in a frame is clipped to the frame", async () => {
  const result = await renderSvg(
    [
      { id: "frame", type: "frame", x: 0, y: 0, width: 100, height: 100 },
      {
        id: "embed",
        type: "embeddable",
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        frameId: "frame",
      },
    ],
    new Map(),
    options,
  )
  expect(result?.svg).toMatch(
    /<g clip-path="url\(#clip-frame\)"><g [^>]*stroke-linecap="round"/,
  )
})

test("applies the export options", async () => {
  const box = [{ ...scene[0], boundElements: null }]
  const plain = await renderSvg(box, new Map(), { ...options, padding: 0 })
  const styled = await renderSvg(box, new Map(), {
    ...options,
    padding: 0,
    darkMode: true,
    background: false,
    scale: 2,
  })
  expect(plain?.svg).toMatch(/<rect x="0" y="0" [^>]*fill="#ffffff"/)
  expect(plain?.svg).not.toContain("filter=")
  expect(styled?.svg).not.toMatch(/fill="#ffffff"/)
  expect(styled?.svg).toContain('filter="invert(93%) hue-rotate(180deg)"')
  // Scale grows the size, not the viewBox.
  expect(styled?.width).toBeCloseTo((plain?.width ?? 0) * 2)
  expect(styled?.svg).toContain(
    `viewBox="0 0 ${plain?.width} ${plain?.height}"`,
  )
})

test("an empty or all-deleted scene has nothing to draw", async () => {
  expect(await renderSvg([], new Map(), options)).toBeNull()
  expect(
    await renderSvg([{ ...scene[0], isDeleted: true }], new Map(), options),
  ).toBeNull()
})
