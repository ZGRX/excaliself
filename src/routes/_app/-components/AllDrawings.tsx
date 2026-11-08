import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { BrowseToolbar } from "@/components/drawing-gallery/BrowseToolbar"
import {
  DEFAULT_SORT,
  filterDrawings,
  type GalleryScope,
  type SortOrder,
  scopedFolderId,
} from "@/components/drawing-gallery/browse"
import { DrawingGallery } from "@/components/drawing-gallery/DrawingGallery"
import {
  FolderEmpty,
  NoMatches,
  QuietLine,
  TeamEmpty,
} from "@/components/drawing-gallery/GalleryEmpty"
import { IllustratedEmptyState } from "@/components/illustrated-empty-state"
import { useTrashDrawing } from "@/features/drawings/mutations"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import type { Folder } from "@/features/folders/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { inBrowsedSpace, useBrowsedSpace } from "@/features/spaces/browse"
import { useDocumentTitle } from "@/lib/document-title"
import { useCreateDialog } from "./CreateDialog"
import { useMoveToTeamDialog } from "./MoveToTeamDialog"

// The browse surface: every drawing of the browsed space, in Home's card
// language, under the toolbar (on-page search, folder chips, sort — spec §5.2).
// Search reaches past the space into both.
export function AllDrawings({ isAdmin }: { isAdmin: boolean }) {
  const space = useBrowsedSpace()
  const { data: allDrawings = [], isPending } = useQuery(drawingsQueryOptions())
  const { data: allFolders = [] } = useQuery(foldersQueryOptions())
  const drawings = useMemo(
    () => inBrowsedSpace(allDrawings, space),
    [allDrawings, space],
  )
  const folders = useMemo(
    () => inBrowsedSpace(allFolders, space),
    [allFolders, space],
  )
  const { openCreateDrawingDialog } = useCreateDialog()
  const trashDrawing = useTrashDrawing()
  const { requestMoveToTeam } = useMoveToTeamDialog()
  useDocumentTitle("All drawings", { chrome: true })

  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<GalleryScope>("all")
  const [sort, setSort] = useState<SortOrder>(DEFAULT_SORT)

  // The scoped folder can be deleted from the sidebar while we hold its id —
  // fall back to the All view instead of filtering on a ghost folder.
  const scopedId = scopedFolderId(scope)
  const liveScope: GalleryScope =
    scopedId !== null && !folders.some((folder) => folder.id === scopedId)
      ? "all"
      : scope

  // A query searches both spaces, whatever the page's space (story 9); the
  // chips still narrow it. Clearing it returns to the space's grid.
  const searchesBothSpaces = space !== null && query.trim() !== ""
  const filtered = useMemo(
    () =>
      filterDrawings(searchesBothSpaces ? allDrawings : drawings, {
        query,
        scope: liveScope,
      }),
    [searchesBothSpaces, allDrawings, drawings, query, liveScope],
  )

  // Tier-1 is reserved for a truly empty account; a grid emptied by the
  // toolbar's filters gets the quiet tier-2 line instead (spec §5.10).
  const hasAnyDrawings = drawings.length > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 py-8">
        <div className="flex items-center pb-5">
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">
            All drawings
          </h1>
        </div>

        {hasAnyDrawings && (
          <div className="pb-5">
            <BrowseToolbar
              query={query}
              onQueryChange={setQuery}
              chips={{ folders, scope: liveScope, onScopeChange: setScope }}
              sort={sort}
              onSortChange={setSort}
            />
          </div>
        )}

        <DrawingGallery
          drawings={filtered}
          // Attribution only in the All view — a scoped grid repeats one
          // folder. Every space's folders, for matches from the other one.
          folders={liveScope === "all" ? allFolders : undefined}
          isPending={isPending}
          sort={sort}
          query={query}
          spaceLabels={searchesBothSpaces}
          loadingLabel="Loading drawings"
          onTrash={trashDrawing}
          onMoveToTeam={requestMoveToTeam}
          selectable
          empty={
            hasAnyDrawings ? (
              <FilteredEmpty
                query={query}
                scope={liveScope}
                folders={folders}
                onCreateInFolder={(folder) =>
                  openCreateDrawingDialog({ id: folder.id, name: folder.name })
                }
              />
            ) : space === "team" ? (
              <TeamEmpty onCreate={openCreateDrawingDialog} />
            ) : (
              <IllustratedEmptyState
                isAdmin={isAdmin}
                onCreate={openCreateDrawingDialog}
              />
            )
          }
        />
      </div>
    </div>
  )
}

// Tier-2 empty state: one quiet line + contextual action, no illustration
// (spec §5.10).
function FilteredEmpty({
  query,
  scope,
  folders,
  onCreateInFolder,
}: {
  query: string
  scope: GalleryScope
  folders: Folder[]
  onCreateInFolder: (folder: Folder) => void
}) {
  const trimmed = query.trim()
  if (trimmed !== "") {
    return <NoMatches query={trimmed} />
  }
  if (scope === "unfiled") {
    return <QuietLine>No unfiled drawings</QuietLine>
  }

  return (
    <FolderEmpty
      folder={folders.find((f) => f.id === scopedFolderId(scope))}
      onCreateInFolder={onCreateInFolder}
    />
  )
}
