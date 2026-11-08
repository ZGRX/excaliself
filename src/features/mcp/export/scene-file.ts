// A drawing as an `.excalidraw` file, in the format Excalidraw's "Save to
// file" writes (serializeAsJSON(…, "local") in 0.18.1), built without
// Excalidraw so it runs on the server.

import type { SceneFile } from "./scene-data"

/** Larger files are refused: an MCP result that big helps no client. */
export const MAX_SCENE_BYTES = 10 * 1024 * 1024

// The appState keys Excalidraw keeps in an exported file.
const EXPORTED_APP_STATE = new Set([
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "viewBackgroundColor",
])

const LINEAR_TYPES = new Set(["line", "arrow"])

export function toExcalidrawFile(scene: {
  elements: readonly Record<string, unknown>[]
  appState: Record<string, unknown>
  files: Map<string, SceneFile>
  /** The instance's origin, as a browser export writes it. */
  source: string
}): string {
  const elements = scene.elements
    .filter((element) => !element.isDeleted)
    .map((element) =>
      typeof element.type === "string" && LINEAR_TYPES.has(element.type)
        ? { ...element, lastCommittedPoint: null }
        : element,
    )
  const appState = Object.fromEntries(
    Object.entries(scene.appState).filter(
      ([key, value]) => EXPORTED_APP_STATE.has(key) && value !== undefined,
    ),
  )
  const files = Object.fromEntries(
    elements.flatMap((element) => {
      const file =
        typeof element.fileId === "string"
          ? scene.files.get(element.fileId)
          : undefined
      return file ? [[file.id, file]] : []
    }),
  )
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: scene.source,
      elements,
      appState,
      files,
    },
    null,
    2,
  )
}
