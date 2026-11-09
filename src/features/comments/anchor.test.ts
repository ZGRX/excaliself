import { expect, test } from "vitest"
import { type AnchorElement, anchorAt, pinPosition } from "./anchor"

const rect = (over: Partial<AnchorElement> = {}): AnchorElement => ({
  id: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  angle: 0,
  ...over,
})

const onRect = { x: 0, y: 0, elementId: "rect", offsetX: 0.5, offsetY: 1 }
const at = (...elements: AnchorElement[]) =>
  new Map(elements.map((element) => [element.id, element]))

test("a point anchor stays put", () => {
  const thread = { x: 5, y: 6, elementId: null, offsetX: null, offsetY: null }
  expect(pinPosition(thread, at(rect()))).toEqual({
    x: 5,
    y: 6,
    detached: false,
  })
})

test("an element anchor follows a move and a resize", () => {
  expect(pinPosition(onRect, at(rect({ x: 10, y: 20, width: 200 })))).toEqual({
    x: 110,
    y: 70,
    detached: false,
  })
})

test("an element anchor follows a rotation around the element's center", () => {
  const { x, y } = pinPosition(onRect, at(rect({ angle: Math.PI / 2 })))
  // Bottom middle (50, 50) turns a quarter around (50, 25) to (25, 25).
  expect(x).toBeCloseTo(25)
  expect(y).toBeCloseTo(25)
})

test("a deleted element leaves the pin on its tombstone, detached", () => {
  expect(pinPosition(onRect, at(rect({ x: 10, isDeleted: true })))).toEqual({
    x: 60,
    y: 50,
    detached: true,
  })
})

test("a missing element leaves the pin where it was made, detached", () => {
  expect(pinPosition({ ...onRect, x: 7, y: 8 }, at())).toEqual({
    x: 7,
    y: 8,
    detached: true,
  })
})

test("a click picks the smallest element under it, as a fraction of its box", () => {
  const frame = rect({ id: "frame", width: 1000, height: 1000 })
  expect(anchorAt({ x: 25, y: 40 }, [frame, rect()], 0)).toEqual({
    x: 25,
    y: 40,
    elementId: "rect",
    offsetX: 0.25,
    offsetY: 0.8,
  })
})

test("a click on bound text anchors to its shape", () => {
  const label = rect({
    id: "label",
    x: 30,
    y: 20,
    width: 40,
    height: 10,
    containerId: "rect",
  })
  expect(anchorAt({ x: 50, y: 25 }, [rect(), label], 0)).toMatchObject({
    elementId: "rect",
  })
})

test("a click near a line drawn leftwards hits it within the tolerance", () => {
  const line = rect({
    id: "line",
    x: 100,
    y: 0,
    width: 100,
    height: 0,
    points: [
      [0, 0],
      [-100, 0],
    ],
  })
  expect(anchorAt({ x: 50, y: 3 }, [line], 4)).toEqual({
    x: 50,
    y: 3,
    elementId: "line",
    offsetX: 0.5,
    offsetY: 0.5,
  })
})

test("a click on empty canvas or a deleted element is a point anchor", () => {
  expect(anchorAt({ x: 500, y: 500 }, [rect()], 4)).toEqual({ x: 500, y: 500 })
  expect(anchorAt({ x: 10, y: 10 }, [rect({ isDeleted: true })], 4)).toEqual({
    x: 10,
    y: 10,
  })
})
