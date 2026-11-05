import { expect, test } from "vitest"
import { parseMermaid } from "./mermaid"
import { SceneInputError } from "./skeleton"

test("reads nodes, their shapes and labels, and labeled edges", () => {
  const graph = parseMermaid(`
    flowchart LR
      %% the checkout flow
      start([Start]) --> cart[Cart page]
      cart --> paid{"Paid?"}
      paid -->|"yes"| done((Done))
      paid -- no --> cart
      classDef hot fill:#f96
      class done hot
  `)

  expect(graph.direction).toBe("LR")
  expect(graph.elements).toEqual([
    { type: "rectangle", id: "start", label: "Start" },
    { type: "rectangle", id: "cart", label: "Cart page" },
    { type: "diamond", id: "paid", label: "Paid?" },
    { type: "ellipse", id: "done", label: "Done" },
    expect.objectContaining({ from: "start", to: "cart", label: undefined }),
    expect.objectContaining({ from: "cart", to: "paid" }),
    expect.objectContaining({ from: "paid", to: "done", label: "yes" }),
    expect.objectContaining({ from: "paid", to: "cart", label: "no" }),
  ])
})

test("style lines color their node", () => {
  const { elements } = parseMermaid(`flowchart TD
    style a fill:#a5d8ff,stroke:#1971c2,stroke-width:2px
    a --> b
    style b fill:url(x)
    style ghost fill:#fff
    style`)

  expect(elements.slice(0, 2)).toEqual([
    {
      type: "rectangle",
      id: "a",
      label: "a",
      backgroundColor: "#a5d8ff",
      strokeColor: "#1971c2",
    },
    { type: "rectangle", id: "b", label: "b" },
  ])
})

test("edge syntax sets the stroke and arrowheads", () => {
  const edges = parseMermaid(`graph TD
    a --> b
    a --- b
    a -.-> b
    a ==> b
    a <--> b
    a -. maybe .-> b
    a --o b
    a ~~~ b`).elements.slice(2)

  expect(
    edges.map((edge) =>
      edge.type === "arrow"
        ? [
            edge.strokeStyle,
            edge.strokeWidth,
            edge.startArrowhead,
            edge.endArrowhead,
            edge.label,
          ]
        : null,
    ),
  ).toEqual([
    ["solid", 2, null, "arrow", undefined],
    ["solid", 2, null, null, undefined],
    ["dashed", 2, null, "arrow", undefined],
    ["solid", 4, null, "arrow", undefined],
    ["solid", 2, "arrow", "arrow", undefined],
    ["dashed", 2, null, "arrow", "maybe"],
    ["solid", 2, null, "circle", undefined],
    // ~~~ only spaces nodes out in Mermaid; nothing is drawn.
  ])
})

test("chains and & groups make one edge per pair", () => {
  const { elements } = parseMermaid("graph TD\n  a & b --> c --> d & e")

  expect(
    elements.flatMap((element) =>
      element.type === "arrow" ? [`${element.from}>${element.to}`] : [],
    ),
  ).toEqual(["a>c", "b>c", "c>d", "c>e"])
})

test("subgraphs become nested clusters, and an edge may point at one", () => {
  const graph = parseMermaid(`flowchart TB
    user --> web
    subgraph cloud [AWS cloud]
      web[Web server]
      subgraph data["Data tier"]
        db[(Postgres)]
      end
      web --> db
    end
    user --> data`)

  expect(graph.clusters).toEqual([
    { id: "cloud", label: "AWS cloud", parent: null, members: ["web"] },
    { id: "data", label: "Data tier", parent: "cloud", members: ["db"] },
  ])
  // The edge to `data` targets the cluster; `data` is no shape of its own.
  expect(graph.elements.map((element) => element.id)).toEqual([
    "user",
    "web",
    "db",
    undefined,
    undefined,
    undefined,
  ])
  expect(graph.elements.at(-1)).toMatchObject({ from: "user", to: "data" })
})

test("labels drop markup and keep line breaks", () => {
  const { elements } = parseMermaid(
    'graph LR\n  a["**Auth** service<br/>port 443"]; b[#quot;quoted#quot;]',
  )

  expect(
    elements.map((element) =>
      element.type !== "arrow" && element.type !== "line" && "label" in element
        ? element.label
        : null,
    ),
  ).toEqual(["Auth service\nport 443", '"quoted"'])
})

test("a front-matter title becomes a text element", () => {
  const { elements } = parseMermaid(
    "---\ntitle: Order flow\n---\nflowchart TD\n  a --> b",
  )

  expect(elements[0]).toEqual({
    type: "text",
    text: "Order flow",
    fontSize: 28,
  })
})

test("other diagram types and unreadable lines are refused", () => {
  expect(() => parseMermaid("sequenceDiagram\n  A->>B: hi")).toThrow(
    /Only Mermaid flowcharts are supported/,
  )
  expect(() => parseMermaid("graph TD\n  a --> ")).toThrow(SceneInputError)
  expect(() => parseMermaid("graph TD\n  a --> b\n  end")).toThrow(
    '"end" without a subgraph',
  )
})

test("hostile input is read in linear time", () => {
  const spaces = " ".repeat(20_000)
  const inputs = [
    `flowchart TD\nA --${spaces}x`,
    `flowchart TD\nsubgraph a[${spaces}x\nend`,
    `flowchart TD\nA["${"<".repeat(20_000)}"]`,
    `flowchart TD\nA["${"**a".repeat(7_000)}"]`,
  ]
  // 600 × 600 edges from one short line.
  const group = Array.from({ length: 600 }, (_, n) => `n${n}`).join(" & ")
  expect(() => parseMermaid(`flowchart TD\n${group} --> ${group}`)).toThrow(
    /more than 500 edges/,
  )
  // Invisible links draw nothing, so they don't count.
  expect(
    parseMermaid(`flowchart TD\n${group} ~~~ ${group}`).elements,
  ).toHaveLength(600)
  for (const input of inputs) {
    const started = performance.now()
    try {
      parseMermaid(input)
    } catch {
      // Refusing is fine; hanging is not.
    }
    expect(performance.now() - started).toBeLessThan(500)
  }
})
