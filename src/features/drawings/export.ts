import { createClientOnlyFn } from "@tanstack/react-start"
import { toast } from "sonner"
import { getDrawingWithFiles } from "./server"

// Lazy: keeps Excalidraw out of the SSR bundle and the Home chunk
const loadExportFile = createClientOnlyFn(() => import("./export-file"))
// Lazy too: only a multi-drawing export needs the zip library
const loadZip = createClientOnlyFn(() => import("fflate"))

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

/** File names made distinct, ignoring case: "Plan.excalidraw", "Plan (2).excalidraw". */
export function distinctFileNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const dot = name.lastIndexOf(".")
    const [base, ext] =
      dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
    let unique = name
    for (let n = 2; used.has(unique.toLowerCase()); n++)
      unique = `${base} (${n})${ext}`
    used.add(unique.toLowerCase())
    return unique
  })
}

const FETCH_CONCURRENCY = 4

/**
 * The bulk "Export": one drawing downloads as a plain `.excalidraw` file,
 * more as a zip of them. Throws if any drawing fails.
 */
export async function exportDrawings(drawings: { id: string }[]) {
  const files: File[] = []
  for (let i = 0; i < drawings.length; i += FETCH_CONCURRENCY)
    files.push(
      ...(await Promise.all(
        drawings
          .slice(i, i + FETCH_CONCURRENCY)
          .map(({ id }) => fetchDrawingFile(id)),
      )),
    )
  if (files.length === 1) {
    downloadFile(files[0])
    return
  }
  const [{ zipSync }, contents] = await Promise.all([
    loadZip(),
    Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))),
  ])
  const names = distinctFileNames(files.map((f) => f.name))
  const zip = zipSync(
    Object.fromEntries(names.map((name, i) => [name, contents[i]])),
  )
  const date = new Date().toISOString().slice(0, 10)
  downloadFile(
    new File([zip], `excaliself-${date}.zip`, { type: "application/zip" }),
  )
}
