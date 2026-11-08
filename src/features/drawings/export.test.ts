import { expect, test, vi } from "vitest"
import { distinctFileNames } from "./export"

vi.mock("./server", () => ({ getDrawingWithFiles: vi.fn() }))

test("zip entry names are distinct, ignoring case", () => {
  expect(
    distinctFileNames([
      "Plan.excalidraw",
      "Plan (2).excalidraw",
      "plan.excalidraw",
      "Notes.excalidraw",
    ]),
  ).toEqual([
    "Plan.excalidraw",
    "Plan (2).excalidraw",
    "plan (3).excalidraw",
    "Notes.excalidraw",
  ])
})
