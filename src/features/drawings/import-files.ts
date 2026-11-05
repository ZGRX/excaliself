import { useQueryClient } from "@tanstack/react-query"
import { createClientOnlyFn } from "@tanstack/react-start"
import { useCallback } from "react"
import { toast } from "sonner"
import type { Space } from "@/db/schema"
import { drawingsQueryOptions } from "./queries"
import { importDrawingFile } from "./server"

// Client-only: @excalidraw/excalidraw is not server-safe.
const loadExcalidraw = createClientOnlyFn(
  () => import("@excalidraw/excalidraw"),
)

/** "Plan.excalidraw" → "Plan", also for .json and .excalidraw.png exports. */
const drawingName = (fileName: string) =>
  fileName.replace(/(\.(excalidraw|json|png|svg))+$/i, "")

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`

const SUPPORTED_FILES =
  "Drop .excalidraw files, or .png and .svg exports that include the scene."

export type ImportTarget = { folderId: string | null; space: Space }

/**
 * Imports files dropped from the computer as new drawings, one request per
 * file, with a progress toast. Excalidraw reads each file, so old versions
 * and .png/.svg exports with the scene embedded work too.
 */
export function useImportDrawingFiles() {
  const queryClient = useQueryClient()

  return useCallback(
    async (files: File[], target: ImportTarget) => {
      const toastId = toast.loading(`Importing ${plural(files.length, "file")}`)
      const { loadFromBlob, serializeAsJSON } = await loadExcalidraw()
      const failed: string[] = []
      let skippedImages = 0

      for (const [index, file] of files.entries()) {
        if (files.length > 1)
          toast.loading(`Importing ${index + 1} of ${files.length}`, {
            id: toastId,
          })
        try {
          const scene = await loadFromBlob(file, null, null)
          const json = serializeAsJSON(
            scene.elements,
            scene.appState,
            scene.files,
            "local",
          )
          const result = await importDrawingFile({
            data: {
              name: drawingName(file.name),
              ...target,
              lastModified: file.lastModified,
              content: JSON.parse(json),
            },
          })
          skippedImages += result.skippedImages
        } catch {
          failed.push(file.name)
        }
      }

      await queryClient.invalidateQueries(drawingsQueryOptions())

      const imported = files.length - failed.length
      if (imported === 0) {
        toast.error(
          files.length === 1
            ? `Couldn't import ${files[0].name}`
            : `Couldn't import ${plural(files.length, "file")}`,
          { id: toastId, description: SUPPORTED_FILES },
        )
        return
      }
      const notes = [
        failed.length > 0 && `Couldn't import ${failed.join(", ")}.`,
        skippedImages > 0 &&
          `${plural(skippedImages, "image")} could not be brought over. The drawings show a placeholder.`,
      ].filter(Boolean)
      toast.success(`Imported ${plural(imported, "drawing")}`, {
        id: toastId,
        description: notes.length > 0 ? notes.join(" ") : undefined,
      })
    },
    [queryClient],
  )
}
