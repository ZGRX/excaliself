// Example content for instances that start with nothing: PR previews seed it
// into PGlite. Plain data with no server imports, so a browser-only demo can
// reuse it.

import type { Space } from "./schema.ts"

type SceneElement = Record<string, unknown>

export type DemoFolder = {
  id: string
  name: string
  space: Space
  parentId: string | null
}

export type DemoDrawing = {
  id: string
  name: string
  space: Space
  folderId: string | null
  /** Last edit, for Home's "recent" order. */
  minutesAgo: number
  starred?: boolean
  elements: SceneElement[]
}

/** The instance's first admin, already past /setup. */
export const demoAdmin = {
  id: "demo-admin",
  name: "Ada Admin",
  email: "admin@example.com",
  password: "preview-password",
}

/** A public MCP access token for demoAdmin, so inspectors can list tools. */
export const demoAccessToken = "exs_preview-mode-public-token"

export const demoFolders: DemoFolder[] = [
  { id: "demo-product", name: "Product", space: "private", parentId: null },
  {
    id: "demo-wireframes",
    name: "Wireframes",
    space: "private",
    parentId: "demo-product",
  },
  { id: "demo-notes", name: "Notes", space: "private", parentId: null },
  {
    id: "demo-architecture",
    name: "Architecture",
    space: "team",
    parentId: null,
  },
]

const ink = "#1e1e1e"
// A drawing opens with the canvas origin at the top left, under the toolbar,
// so every scene starts this far in.
const inset = 160

function shape(
  type: "rectangle" | "ellipse" | "diamond",
  id: string,
  [x, y, width, height]: [number, number, number, number],
  backgroundColor = "transparent",
): SceneElement {
  return {
    id,
    type,
    x: x + inset,
    y: y + inset,
    width,
    height,
    strokeColor: ink,
    backgroundColor,
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    roundness: type === "rectangle" ? { type: 3 } : null,
  }
}

// Width is estimated: Excalidraw measures text again when it renders it.
function text(
  id: string,
  [x, y]: [number, number],
  value: string,
  fontSize = 20,
): SceneElement {
  const lines = value.split("\n")
  return {
    id,
    type: "text",
    x: x + inset,
    y: y + inset,
    width: Math.max(...lines.map((line) => line.length)) * fontSize * 0.55,
    height: lines.length * fontSize * 1.25,
    text: value,
    originalText: value,
    fontSize,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    lineHeight: 1.25,
    strokeColor: ink,
  }
}

function arrow(
  id: string,
  [x, y]: [number, number],
  [dx, dy]: [number, number],
): SceneElement {
  return {
    id,
    type: "arrow",
    x: x + inset,
    y: y + inset,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
    strokeColor: ink,
    strokeWidth: 2,
    roughness: 1,
    roundness: { type: 2 },
    endArrowhead: "arrow",
  }
}

export const demoDrawings: DemoDrawing[] = [
  {
    id: "demo-welcome",
    name: "Welcome",
    space: "private",
    folderId: null,
    minutesAgo: 5,
    starred: true,
    elements: [
      text("welcome-title", [0, 0], "Welcome to Excaliself", 36),
      text(
        "welcome-body",
        [0, 70],
        "This is a preview instance with example content.\nChanges are lost when the app restarts.",
      ),
      shape("ellipse", "welcome-sun", [520, -20, 90, 90], "#ffec99"),
    ],
  },
  {
    id: "demo-release-flow",
    name: "Release flow",
    space: "private",
    folderId: "demo-product",
    minutesAgo: 60,
    elements: [
      shape("rectangle", "flow-idea", [0, 0, 160, 80], "#a5d8ff"),
      text("flow-idea-label", [50, 28], "Idea"),
      arrow("flow-arrow-1", [170, 40], [80, 0]),
      shape("rectangle", "flow-build", [260, 0, 160, 80], "#b2f2bb"),
      text("flow-build-label", [310, 28], "Build"),
      arrow("flow-arrow-2", [430, 40], [80, 0]),
      shape("diamond", "flow-review", [520, -20, 160, 120], "#ffec99"),
      text("flow-review-label", [565, 28], "Review"),
      arrow("flow-arrow-3", [690, 40], [80, 0]),
      shape("rectangle", "flow-ship", [780, 0, 160, 80], "#ffc9c9"),
      text("flow-ship-label", [830, 28], "Ship"),
    ],
  },
  {
    id: "demo-login-wireframe",
    name: "Login screen",
    space: "private",
    folderId: "demo-wireframes",
    minutesAgo: 60 * 26,
    elements: [
      shape("rectangle", "login-frame", [0, 0, 320, 400]),
      text("login-title", [40, 30], "Sign in", 28),
      shape("rectangle", "login-email", [40, 100, 240, 44]),
      text("login-email-label", [52, 112], "Email", 16),
      shape("rectangle", "login-password", [40, 164, 240, 44]),
      text("login-password-label", [52, 176], "Password", 16),
      shape("rectangle", "login-button", [40, 240, 240, 48], "#1e1e1e"),
      {
        ...text("login-button-label", [130, 253], "Sign in", 18),
        strokeColor: "#ffffff",
      },
    ],
  },
  {
    id: "demo-weekly-planning",
    name: "Weekly planning",
    space: "private",
    folderId: "demo-notes",
    minutesAgo: 60 * 50,
    elements: [
      shape("rectangle", "plan-note-1", [0, 0, 180, 140], "#ffec99"),
      text("plan-note-1-text", [16, 16], "Fix share\ndialog copy"),
      shape("rectangle", "plan-note-2", [210, 20, 180, 140], "#d0bfff"),
      text("plan-note-2-text", [226, 36], "Write the\nrelease notes"),
      shape("rectangle", "plan-note-3", [420, 0, 180, 140], "#b2f2bb"),
      text("plan-note-3-text", [436, 16], "Try the new\nteam space"),
    ],
  },
  {
    id: "demo-system-overview",
    name: "System overview",
    space: "team",
    folderId: "demo-architecture",
    minutesAgo: 60 * 3,
    elements: [
      shape("rectangle", "system-browser", [0, 0, 180, 80], "#a5d8ff"),
      text("system-browser-label", [45, 28], "Browser"),
      arrow("system-arrow-1", [190, 40], [100, 0]),
      shape("rectangle", "system-app", [300, 0, 180, 80], "#b2f2bb"),
      text("system-app-label", [340, 28], "Excaliself"),
      arrow("system-arrow-2", [490, 40], [100, 0]),
      shape("ellipse", "system-db", [600, -10, 160, 100], "#ffec99"),
      text("system-db-label", [640, 28], "Postgres"),
    ],
  },
]
