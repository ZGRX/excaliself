import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { FolderInput, Pencil, Star, StarOff, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { RenameDialog } from "@/components/rename-dialog"
import {
  useMoveDrawingToFolder,
  useToggleStarDrawing,
  useTrashDrawing,
} from "@/features/drawings/mutations"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import {
  type PaletteContextSection,
  usePaletteContextSection,
} from "./CommandPalette"

type DrawingPaletteContextProps = {
  drawingId: string
}

/**
 * Contributes the canvas's "This drawing" palette section (spec §5.4):
 * Rename (closes into the standard rename dialog), Star/Unstar (label follows
 * current state), Move to folder… (nested picker, optimistic move), Move to
 * trash (tier-1: instant, undo toast, lands on Home).
 * Reads from the live drawings list, so a trashed drawing — whose section is
 * a later slice — contributes nothing.
 */
export function DrawingPaletteContext({
  drawingId,
}: DrawingPaletteContextProps) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)

  // The list cache, not the detail query: renames and star toggles patch the
  // list optimistically, so row labels track them in the same frame
  const { data: drawing } = useQuery({
    ...drawingsQueryOptions(),
    select: (drawings) => drawings.find((d) => d.id === drawingId),
  })

  const starMutation = useToggleStarDrawing()
  const starMutate = starMutation.mutate
  const moveMutation = useMoveDrawingToFolder()
  const moveMutate = moveMutation.mutate
  const trashDrawing = useTrashDrawing()
  // Latest-ref so the section memo doesn't rebuild every render just because
  // useTrashDrawing returns a fresh closure each time
  const trashDrawingRef = useRef(trashDrawing)
  useEffect(() => {
    trashDrawingRef.current = trashDrawing
  })

  const section = useMemo<PaletteContextSection | null>(() => {
    if (!drawing) return null
    return {
      title: "This drawing",
      rows: [
        {
          id: "drawing:rename",
          label: "Rename",
          icon: Pencil,
          onSelect: () => setRenameOpen(true),
        },
        {
          id: "drawing:star",
          label: drawing.starred ? "Unstar" : "Star",
          icon: drawing.starred ? StarOff : Star,
          onSelect: () =>
            starMutate({
              data: { id: drawing.id, starred: !drawing.starred },
            }),
        },
        {
          id: "drawing:move-folder",
          label: "Move to folder…",
          icon: FolderInput,
          // Reversible mutation, so no confirm: the move lands optimistically
          // and rolls back with an error toast on failure (spec §4.3)
          pickFolder: (folderId) => {
            // Same destination is a no-op — the server refreshes updatedAt on
            // every update, which would wrongly promote the drawing in the
            // recency-sorted launcher (same guard as the sidebar drag-drop)
            if (folderId === drawing.folderId) return
            moveMutate({ data: { id: drawing.id, updateData: { folderId } } })
          },
        },
        {
          id: "drawing:trash",
          label: "Move to trash",
          icon: Trash2,
          destructive: true,
          onSelect: () => {
            // Instant, no confirm — the mutation shows the undo toast itself.
            // The viewed drawing was just trashed, so land on Home, not on a
            // read-only canvas under a purge banner.
            trashDrawingRef.current(drawing)
            navigate({ to: "/draw" })
          },
        },
      ],
    }
  }, [drawing, starMutate, moveMutate, navigate])

  usePaletteContextSection(section)

  if (!drawing) return null
  return (
    <RenameDialog
      open={renameOpen}
      onOpenChange={setRenameOpen}
      target={{ kind: "drawing", id: drawing.id, name: drawing.name }}
    />
  )
}
