// Mermaid flowcharts as scene skeletons. Mermaid's own parser renders with a
// browser DOM, so this reads the flowchart syntax itself: nodes and their
// shapes, edges and their labels and styles, and subgraphs. A `style` line
// gives a node its fill and stroke colors; other styling lines (classDef,
// click, ...) are skipped.

import {
  type Cluster,
  type ConnectorSkeleton,
  type Direction,
  MAX_ELEMENTS,
  type SceneGraph,
  SceneInputError,
  type ShapeSkeleton,
} from "./skeleton"

type Shape = ShapeSkeleton["type"]

// Longest opener first, so "((" is not read as "(".
const NODE_SHAPES: [open: string, close: string, shape: Shape][] = [
  ["(((", ")))", "ellipse"],
  ["((", "))", "ellipse"],
  ["([", "])", "rectangle"],
  ["[[", "]]", "rectangle"],
  ["[(", ")]", "rectangle"],
  ["[/", "/]", "rectangle"],
  ["[\\", "\\]", "rectangle"],
  ["[/", "\\]", "rectangle"],
  ["[\\", "/]", "rectangle"],
  ["{{", "}}", "rectangle"],
  ["(", ")", "rectangle"],
  ["[", "]", "rectangle"],
  ["{", "}", "diamond"],
  [">", "]", "rectangle"],
]

// `style id fill:#a5d8ff,stroke:#1971c2,stroke-width:2px`
const STYLE = /^style\s+(\S+)\s+(.+)$/
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{1,20})$/i
const SKIPPED =
  /^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction)\b/
const NODE_ID = /^[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*/u
// `-- text -->`, `-. text .->`, `== text ==>`: an opener, then a closer
// after the label. Two steps, as one regex backtracks for ages on a long
// run of spaces.
const INLINE_OPENER = /^(<)?(--|-\.|==)(?=\s)/
const INLINE_CLOSER = /\s(-{2,}>|-{3,}|\.-+>|\.-+|={2,}>|={3,})/
// `-->`, `---`, `-.->`, `==>`, `===`, `--o`, `--x`, `<-->`, `~~~`
const EDGE = /^(<)?(-{2,}|-\.+-|={2,}|~{3,})(>|o(?=[\s|])|x(?=[\s|]))?/

type Edge = Pick<
  ConnectorSkeleton,
  "label" | "strokeStyle" | "strokeWidth" | "startArrowhead" | "endArrowhead"
> & { invisible: boolean }

/** Parses a Mermaid flowchart. Throws SceneInputError on anything else. */
export function parseMermaid(source: string): SceneGraph {
  // Front matter: `---`, `title: ...`, `---`
  const frontMatter = source.match(/^\s*---\r?\n([\s\S]*?)\r?\n---[^\n]*\n/)
  const title = frontMatter?.[1].match(/^title:\s*(.+)$/m)?.[1].trim()
  const statements = splitStatements(
    frontMatter ? source.slice(frontMatter[0].length) : source,
  )
  const header = statements.shift()?.match(/^(flowchart|graph)(?:\s+(\w+))?$/i)
  if (!header) {
    throw new SceneInputError(
      'Only Mermaid flowcharts are supported: start with "flowchart TD" or "graph LR". For other diagrams, send elements instead.',
    )
  }
  const direction = toDirection(header[2])

  const shapes = new Map<string, ShapeSkeleton>()
  const connectors: ConnectorSkeleton[] = []
  const clusters: Cluster[] = []
  // As Mermaid does, a node belongs to the first subgraph to close that
  // mentions it, so inner subgraphs claim theirs before outer ones.
  const open: { cluster: Cluster; mentioned: Set<string> }[] = []
  const claimed = new Set<string>()
  const styles: [id: string, props: string][] = []

  const addNode = (id: string, label?: string, type?: Shape) => {
    open.at(-1)?.mentioned.add(id)
    const existing = shapes.get(id)
    if (existing) {
      if (label !== undefined) existing.label = label
      if (type) existing.type = type
      return
    }
    shapes.set(id, { type: type ?? "rectangle", id, label: label ?? id })
  }

  for (const statement of statements) {
    const style = statement.match(STYLE)
    if (style) styles.push([style[1], style[2]])
    if (SKIPPED.test(statement)) continue
    const subgraph = statement.match(/^subgraph\s+(.+)$/)
    if (subgraph) {
      const { id, label } = parseSubgraphTitle(subgraph[1])
      const cluster: Cluster = {
        id,
        label,
        parent: open.at(-1)?.cluster.id ?? null,
        members: [],
      }
      clusters.push(cluster)
      open.push({ cluster, mentioned: new Set() })
      continue
    }
    if (statement === "end") {
      const closing = open.pop()
      if (!closing)
        throw new SceneInputError('Mermaid: "end" without a subgraph.')
      for (const id of closing.mentioned) {
        if (claimed.has(id)) continue
        claimed.add(id)
        closing.cluster.members.push(id)
      }
      continue
    }
    parseChain(statement, addNode, (from, to, { invisible, ...style }) => {
      if (invisible) return
      // `a & b --> c & d` makes an edge per pair: refuse before allocating.
      if (connectors.length + from.length * to.length > MAX_ELEMENTS) {
        throw new SceneInputError(
          `Mermaid: more than ${MAX_ELEMENTS} edges; the limit is ${MAX_ELEMENTS} elements.`,
        )
      }
      for (const source of from)
        for (const target of to)
          connectors.push({ type: "arrow", from: source, to: target, ...style })
    })
  }

  // A subgraph can be named by an edge before it is declared; it is a
  // cluster, not a node.
  if (open.length > 0) {
    throw new SceneInputError(
      `Mermaid: subgraph "${open[0].cluster.id}" has no "end".`,
    )
  }
  for (const [id, props] of styles) {
    const shape = shapes.get(id)
    if (!shape) continue
    for (const prop of props.split(",")) {
      const [key, value = ""] = prop.split(":").map((part) => part.trim())
      if (!COLOR.test(value)) continue
      if (key === "fill") shape.backgroundColor = value
      if (key === "stroke") shape.strokeColor = value
    }
  }
  for (const cluster of clusters) {
    shapes.delete(cluster.id)
    for (const other of clusters) {
      other.members = other.members.filter((member) => member !== cluster.id)
    }
  }

  return {
    elements: [
      ...(title ? [{ type: "text" as const, text: title, fontSize: 28 }] : []),
      ...shapes.values(),
      ...connectors,
    ],
    clusters,
    direction,
  }
}

function toDirection(value: string | undefined): Direction {
  switch (value?.toUpperCase()) {
    case "LR":
      return "LR"
    case "RL":
      return "RL"
    case "BT":
      return "BT"
    default:
      return "TB"
  }
}

/** Lines, then `;`-separated statements, outside of quotes and brackets. */
function splitStatements(source: string): string[] {
  const statements: string[] = []
  for (const line of source.split(/\r?\n/)) {
    if (line.trim().startsWith("%%")) continue
    let depth = 0
    let quoted = false
    let current = ""
    for (const char of line) {
      if (char === '"') quoted = !quoted
      else if (!quoted && "[({".includes(char)) depth++
      else if (!quoted && "])}".includes(char)) depth = Math.max(0, depth - 1)
      if (char === ";" && depth === 0 && !quoted) {
        statements.push(current)
        current = ""
      } else current += char
    }
    statements.push(current)
  }
  return statements.map((statement) => statement.trim()).filter(Boolean)
}

function parseSubgraphTitle(title: string): { id: string; label: string } {
  // `id [Title]` or `id["Title"]`
  const open = title.indexOf("[")
  const id = title.slice(0, open).trim()
  if (open > 0 && title.endsWith("]") && !/\s/.test(id)) {
    return { id, label: cleanLabel(title.slice(open + 1, -1)) }
  }
  const quoted = title.match(/^"(.*)"$/)
  if (quoted) return { id: quoted[1], label: cleanLabel(quoted[1]) }
  return { id: title, label: cleanLabel(title) }
}

/** `<br>` becomes a line break; quotes, other markup, and entity codes go. */
function cleanLabel(label: string): string {
  return label
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^<>]+>/g, "")
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, "&")
    .replace(/#lt;/g, "<")
    .replace(/#gt;/g, ">")
    .replace(/^`|`$/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim()
}

/** `A & B --> C -->|label| D`: node groups joined by edges. */
function parseChain(
  statement: string,
  addNode: (id: string, label?: string, type?: Shape) => void,
  addEdges: (from: string[], to: string[], edge: Edge) => void,
) {
  let rest = statement
  const fail = (): never => {
    throw new SceneInputError(`Mermaid: can't read "${statement}".`)
  }

  const readGroup = (): string[] => {
    const ids: string[] = []
    for (;;) {
      rest = rest.trimStart()
      const id = rest.match(NODE_ID)?.[0] ?? fail()
      rest = rest.slice(id.length)
      const shape = readShape()
      addNode(id, shape?.label, shape?.type)
      // `:::className`
      rest = rest.replace(/^:::[\w-]+/, "").trimStart()
      ids.push(id)
      if (!rest.startsWith("&")) return ids
      rest = rest.slice(1)
    }
  }

  const readShape = (): { label: string; type: Shape } | null => {
    for (const [openToken, closeToken, type] of NODE_SHAPES) {
      if (!rest.startsWith(openToken)) continue
      const body = rest.slice(openToken.length)
      const quoted = body.match(/^\s*"((?:[^"\\]|\\.)*)"\s*/)
      const end = quoted ? quoted[0].length : body.indexOf(closeToken)
      if (end === -1 || !body.slice(end).startsWith(closeToken)) continue
      rest = body.slice(end + closeToken.length)
      return {
        label: cleanLabel(quoted ? quoted[1] : body.slice(0, end)),
        type,
      }
    }
    return null
  }

  const readInlineLabel = () => {
    const opener = rest.match(INLINE_OPENER)
    if (!opener) return null
    const after = rest.slice(opener[0].length)
    const closer = after.match(INLINE_CLOSER)
    const label = closer && cleanLabel(after.slice(0, closer.index))
    if (!closer || !label) return null
    rest = after.slice((closer.index ?? 0) + closer[0].length)
    return {
      startHead: opener[1],
      body: `${opener[2]}${closer[1]}`,
      closer: closer[1],
      label,
    }
  }

  const readEdge = (): Edge | null => {
    rest = rest.trimStart()
    const inline = readInlineLabel()
    const plain = inline ? null : rest.match(EDGE)
    if (!inline && !plain) return null
    if (plain) rest = rest.slice(plain[0].length)
    const startHead = inline ? inline.startHead : plain?.[1]
    const body = inline ? inline.body : (plain?.[2] ?? "")
    const head = inline ? inline.closer.at(-1) : plain?.[3]
    let label = inline?.label
    const piped = rest.match(/^\s*\|([^|]*)\|/)
    if (piped) {
      label = cleanLabel(piped[1])
      rest = rest.slice(piped[0].length)
    }
    const arrowhead = (char: string | undefined) =>
      char === ">" || char === "<"
        ? "arrow"
        : char === "o"
          ? "circle"
          : char === "x"
            ? "bar"
            : null
    return {
      label: label || undefined,
      strokeStyle: body.includes(".") ? "dashed" : "solid",
      strokeWidth: body.includes("=") ? 4 : 2,
      startArrowhead: arrowhead(startHead),
      endArrowhead: arrowhead(head),
      invisible: body.startsWith("~"),
    }
  }

  let from = readGroup()
  for (;;) {
    const edge = readEdge()
    if (!edge) break
    const to = readGroup()
    addEdges(from, to, edge)
    from = to
  }
  if (rest.trim()) fail()
}
