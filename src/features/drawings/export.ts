import { createClientOnlyFn } from "@tanstack/react-start"
import { toast } from "sonner"
import { getDrawingWithFiles } from "./server"

// Lazy: keeps Excalidraw out of the SSR bundle and the Home chunk
const loadExportFile = createClientOnlyFn(() => import("./export-file"))

/** Loads a drawing with its images as an `.excalidraw` file, without opening it. */
export async function fetchDrawingFile(id: string): Promise<File> {
  const [drawing, { toExcalidrawFile }] = await Promise.all([
    getDrawingWithFiles({ data: id }),
    loadExportFile(),
  ])
  if (!drawing) throw new Error("Drawing not found")
  return toExcalidrawFile(drawing)
}

/** Hands a file to the browser's download. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = url
  link.download = file.name
  link.click()
  // Some browsers read the URL after click() returns
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The "Export" menu action: downloads one drawing, or toasts why not. */
export async function exportDrawing(drawing: { id: string; name: string }) {
  try {
    downloadFile(await fetchDrawingFile(drawing.id))
  } catch {
    toast.error(`Couldn't export "${drawing.name}"`, {
      description: "Try again, or open the drawing and save it from its menu.",
    })
  }
}
