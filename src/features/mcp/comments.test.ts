import { expect, test } from "vitest"
import { anchorForTool, describeAnchor } from "./comments"

const box = {
  id: "box",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 40,
}
const label = {
  id: "label",
  type: "text",
  containerId: "box",
  text: "Login",
  x: 30,
  y: 30,
}
const gone = {
  id: "gone",
  type: "ellipse",
  x: -50,
  y: -50,
  width: 1,
  height: 1,
  isDeleted: true,
}
const elements = [box, label, gone]

const onElement = (elementId: string) => ({
  x: 0,
  y: 0,
  elementId,
  offsetX: 0.5,
  offsetY: 0.5,
})

test("an element anchor reports the element's label, or that it is deleted", () => {
  expect(describeAnchor(onElement("box"), elements)).toEqual({
    element: { id: "box", label: 'rectangle "Login"' },
  })
  expect(describeAnchor(onElement("gone"), elements)).toEqual({
    element: { id: "gone", deleted: true },
  })
})

test("add_comment pins to the middle of the element, bound text to its shape", () => {
  const middle = { x: 60, y: 40, elementId: "box", offsetX: 0.5, offsetY: 0.5 }
  expect(anchorForTool(elements, "box")).toEqual(middle)
  expect(anchorForTool(elements, "label")).toEqual(middle)
  expect(() => anchorForTool(elements, "gone")).toThrow(
    "No element has that id",
  )
})

test("add_comment without an element pins to the content's top-left", () => {
  expect(anchorForTool(elements, undefined)).toEqual({ x: 10, y: 20 })
  expect(anchorForTool([], undefined)).toEqual({ x: 0, y: 0 })
})
