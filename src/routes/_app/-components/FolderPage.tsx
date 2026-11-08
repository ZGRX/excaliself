import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { BrowseToolbar } from "@/components/drawing-gallery/BrowseToolbar"
import {
  DEFAULT_SORT,
  filterDrawings,
  type SortOrder,
} from "@/components/drawing-gallery/browse"
import { DrawingGallery } from "@/components/drawing-gallery/DrawingGallery"
import {
  FolderEmpty,
  NoMatches,
} from "@/components/drawing-gallery/GalleryEmpty"
import { useTrashDrawing } from "@/features/drawings/mutations"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { useDocumentTitle } from "@/lib/document-title"
import { useCreateDialog } from "./CreateDialog"
import { useMoveToTeamDialog } from "./MoveToTeamDialog"

// The folder page (spec §5.3): browse scoped to one folder — same grid and
// toolbar as /drawings, with the chip row hidden and no folder attribution
// on cards (the scope is the page itself).
export function FolderPage({ folderId }: { folderId: string }) {
  const { data: drawings = [], isPending } = useQuery(drawingsQueryOptions())
  const { data: folders = [] } = useQuery(foldersQueryOptions())
  const { openCreateDrawingDialog } = useCreateDialog()
  const trashDrawing = useTrashDrawing()
  const { requestMoveToTeam } = useMoveToTeamDialog()
  const navigate = useNavigate()

  const folder = folders.find((candidate) => candidate.id === folderId)

  // The route loader guards entry; this covers the folder being deleted
  // (e.g. from the sidebar) while the page is open — land on /drawings,
  // never an error screen.
  useEffect(() => {
    if (!folder) navigate({ to: "/drawings" })
  }, [folder, navigate])

  useDocumentTitle(folder?.name ?? null, { chrome: true })

  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortOrder>(DEFAULT_SORT)

  const scope = useMemo(() => ({ folderId }), [folderId])
  const filtered = useMemo(
    () => filterDrawings(drawings, { query, scope }),
    [drawings, query, scope],
  )

  if (!folder) return null

  // Tier-2 “This folder is empty” owns a folder with nothing in it; the
  // toolbar only appears once there is something to search or sort.
  const hasFolderDrawings = drawings.some(
    (drawing) => drawing.folderId === folderId,
  )
  const trimmedQuery = query.trim()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 py-8">
        <div className="flex items-center pb-5">
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">
            {folder.name}
          </h1>
        </div>

        {hasFolderDrawings && (
          <div className="pb-5">
            <BrowseToolbar
              query={query}
              onQueryChange={setQuery}
              sort={sort}
              onSortChange={setSort}
            />
          </div>
        )}

        <DrawingGallery
          drawings={filtered}
          isPending={isPending}
          sort={sort}
          query={query}
          loadingLabel="Loading drawings"
          onTrash={trashDrawing}
          onMoveToTeam={requestMoveToTeam}
          selectable
          empty={
            trimmedQuery !== "" ? (
              <NoMatches query={trimmedQuery} />
            ) : (
              <FolderEmpty
                folder={folder}
                onCreateInFolder={({ id, name }) =>
                  openCreateDrawingDialog({ id, name })
                }
              />
            )
          }
        />
      </div>
    </div>
  )
}
