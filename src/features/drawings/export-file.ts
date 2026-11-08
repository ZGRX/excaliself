import { MIME_TYPES, serializeAsJSON } from "@excalidraw/excalidraw"
import { buildInitialSceneData, type PersistedFile } from "./scene"

/**
 * A stored drawing as an `.excalidraw` file, byte for byte what Excalidraw's
 * "Save to file" writes. Imports Excalidraw: load it lazily, client-side only.
 */
export function toExcalidrawFile(drawing: {
  name: string
  data: string
  files: PersistedFile[]
}): File {
  const { initialData, isDataCorrupt } = buildInitialSceneData(drawing)
  if (isDataCorrupt) throw new Error("The drawing's scene is corrupt")
  const json = serializeAsJSON(
    initialData.elements ?? [],
    initialData.appState ?? {},
    initialData.files ?? {},
    "local",
  )
  // Names can hold characters no file system allows in a file name
  const name = drawing.name.replace(/[\\/:*?"<>|]/g, "-")
  return new File([json], `${name}.excalidraw`, { type: MIME_TYPES.excalidraw })
}
