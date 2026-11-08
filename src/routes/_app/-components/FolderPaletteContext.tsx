import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { File, Pencil, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { RenameDialog } from "@/components/rename-dialog"
import { useTrashFolder } from "@/features/folders/mutations"
import { foldersQueryOptions } from "@/features/folders/queries"
import {
  type PaletteContextSection,
  usePaletteContextSection,
} from "./CommandPalette"
import { useCreateDialog } from "./CreateDialog"

type FolderPaletteContextProps = {
  folderId: string
}

/**
 * Contributes the folder page's "This folder" palette section (spec §5.3):
 * New drawing in this folder (closes into the create dialog scoped here),
 * Rename folder (closes into the standard rename dialog), Move folder to
 * trash (tier-1: the whole subtree as one unit, instant, undo toast, lands
 * on Home). Reads from the live folders list, so a folder trashed from
 * another surface contributes nothing.
 */
export function FolderPaletteContext({ folderId }: FolderPaletteContextProps) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)

  // The list cache, not a detail query: renames patch the list
  // optimistically, so the dialog prefill tracks them in the same frame
  const { data: folder } = useQuery({
    ...foldersQueryOptions(),
    select: (folders) => folders.find((f) => f.id === folderId),
  })

  const { openCreateDrawingDialog } = useCreateDialog()
  const trashFolder = useTrashFolder()
  // Latest-ref so the section memo doesn't rebuild every render just because
  // useTrashFolder returns a fresh closure each time
  const trashFolderRef = useRef(trashFolder)
  useEffect(() => {
    trashFolderRef.current = trashFolder
  })

  const section = useMemo<PaletteContextSection | null>(() => {
    if (!folder) return null
    return {
      title: "This folder",
      rows: [
        {
          id: "folder:new-drawing",
          label: "New drawing in this folder",
          icon: File,
          onSelect: () =>
            openCreateDrawingDialog({ id: folder.id, name: folder.name }),
        },
        {
          id: "folder:rename",
          label: "Rename folder",
          icon: Pencil,
          onSelect: () => setRenameOpen(true),
        },
        {
          id: "folder:trash",
          label: "Move folder to trash",
          icon: Trash2,
          destructive: true,
          onSelect: async () => {
            // Instant, no confirm — the mutation shows the undo toast itself.
            // Land on Home *before* trashing: the optimistic prune drops this
            // folder from the list cache, and FolderPage escapes a vanished
            // folder to /drawings — if the prune won that race, it would
            // override the Home landing the spec asks for.
            try {
              await navigate({ to: "/draw" })
            } catch {
              // A failed navigation must not cancel the trash — FolderPage's
              // vanished-folder escape still moves the user off the dead page.
            }
            trashFolderRef.current(folder)
          },
        },
      ],
    }
  }, [folder, openCreateDrawingDialog, navigate])

  usePaletteContextSection(section)

  if (!folder) return null
  return (
    <RenameDialog
      open={renameOpen}
      onOpenChange={setRenameOpen}
      target={{ kind: "folder", id: folder.id, name: folder.name }}
    />
  )
}
