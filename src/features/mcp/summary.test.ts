import { expect, test } from "vitest"
import { summarizeScene } from "./summary"

const shape = (
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: object = {},
) => ({ id, type, x, y, width, height, ...extra })

const label = (id: string, containerId: string, text: string) => ({
  id,
  type: "text",
  containerId,
  text: text.replace(" ", "\n"),
  originalText: text,
})

test("names shapes, follows connections, and places text", () => {
  const summary = summarizeScene([
    shape("zone", "rectangle", 0, 0, 600, 300, { strokeStyle: "dashed" }),
    label("zone-label", "zone", "Backend"),
    shape("api", "rectangle", 40, 60, 160, 80, { backgroundColor: "#a5d8ff" }),
    label("api-label", "api", "API server"),
    shape("db", "ellipse", 380, 60, 160, 80),
    label("db-label", "db", "Postgres"),
    {
      id: "query",
      type: "arrow",
      x: 206,
      y: 100,
      points: [
        [0, 0],
        [168, 0],
      ],
      startBinding: { elementId: "api" },
      endBinding: { elementId: "db" },
      startArrowhead: null,
      endArrowhead: "arrow",
    },
    label("query-label", "query", "SQL"),
    // Drawn by hand: it ends on the API box without being attached.
    {
      id: "sketched",
      type: "arrow",
      x: 100,
      y: 400,
      points: [
        [0, 0],
        [10, -255],
      ],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
      strokeStyle: "dotted",
    },
    // Excalidraw binds arrows to text too.
    {
      id: "from-title",
      type: "arrow",
      x: 30,
      y: -30,
      points: [
        [0, 0],
        [40, 85],
      ],
      startBinding: { elementId: "title" },
      endBinding: { elementId: "api" },
      endArrowhead: "arrow",
    },
    {
      id: "rule",
      type: "line",
      x: 0,
      y: 500,
      points: [
        [0, 0],
        [600, 0],
      ],
    },
    {
      id: "note",
      type: "text",
      x: 60,
      y: 200,
      text: "Reads only",
      originalText: "Reads only",
    },
    { id: "title", type: "text", x: 0, y: -60, text: "Read path" },
    {
      id: "gone",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      isDeleted: true,
    },
    { id: "scribble", type: "freedraw", x: 700, y: 0, width: 50, height: 50 },
  ])

  expect(summary).toBe(
    `14 elements. Positions are canvas pixels (x right, y down); S1, S2, … name shapes in reading order; [id …] is the element's id.

Shapes:
S1 "Backend" [id zone]: rectangle at (0, 0), 600×300, dashed
S2 "API server" [id api]: rectangle at (40, 60), 160×80, fill #a5d8ff, inside S1
S3 "Postgres" [id db]: ellipse at (380, 60), 160×80, inside S1

Connections:
S2 "API server" → S3 "Postgres" [id query], labeled "SQL"
(100, 400) → S2 "API server" (not attached) [id sketched], dotted
text "Read path" → S2 "API server" [id from-title]
(0, 500) — (600, 500) (line, no arrowheads) [id rule]

Text:
"Read path" [id title] at (0, -60)
"Reads only" [id note] at (60, 200), inside S1

Also 1 freehand stroke.`,
  )
})

test("an empty or fully deleted scene says so", () => {
  expect(summarizeScene([])).toBe("The drawing is empty.")
  expect(
    summarizeScene([{ id: "a", type: "rectangle", isDeleted: true }]),
  ).toBe("The drawing is empty.")
})
