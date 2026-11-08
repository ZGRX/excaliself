import { useQuery } from "@tanstack/react-query"
import {
  Download,
  FolderInput,
  Star,
  StarOff,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { currentUserQueryOptions } from "@/features/account/queries"
import {
  countDrawings,
  useBulkMoveToFolder,
  useBulkMoveToTeam,
  useBulkStar,
  useBulkTrash,
} from "@/features/drawings/bulk-mutations"
import { exportDrawings } from "@/features/drawings/export"
import type { Drawing } from "@/features/drawings/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { folderPaths } from "@/features/folders/subtree"
import { cn } from "@/lib/utils"

/**
 * The bulk action bar over a gallery with a selection: the count, Select
 * all, and the actions. Moves and trash end the selection; Star and Export
 * keep it.
 */
export function SelectionBar({
  selected,
  total,
  onSelectAll,
  onClear,
}: {
  /** The selected drawings, in grid order. */
  selected: Drawing[]
  /** Cards on screen, for Select all. */
  total: number
  onSelectAll: () => void
  onClear: () => void
}) {
  const ids = selected.map((d) => d.id)
  const count = selected.length
  const space = selected.every((d) => d.space === selected[0]?.space)
    ? selected[0]?.space
    : undefined
  const { data: teamEnabled = false } = useQuery({
    ...currentUserQueryOptions(),
    select: (user) => user.teamEnabled,
  })

  const star = useBulkStar()
  const moveToFolder = useBulkMoveToFolder()
  const moveToTeam = useBulkMoveToTeam()
  const trash = useBulkTrash()
  const [confirmTeam, setConfirmTeam] = useState(false)
  const [exporting, setExporting] = useState(false)

  const allStarred = selected.every((d) => d.starred)

  const onExport = async () => {
    setExporting(true)
    const toastId = toast.loading(`Exporting ${countDrawings(count)}`)
    try {
      await exportDrawings(selected)
      toast.dismiss(toastId)
    } catch {
      toast.error("Couldn't export", { id: toastId })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      {/* Room to scroll the last row above the bar */}
      <div aria-hidden className="h-16 shrink-0" />
      {/* Fixed, as the page scrolls the document. Centered over the panel:
          past the sidebar unless it is collapsed. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4 md:pl-[calc(var(--sidebar-width)+1rem)] md:group-has-[[data-collapsible=offcanvas]]/sidebar-wrapper:pl-4">
        <div
          role="region"
          aria-label="Selected drawings"
          className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-xl border border-border bg-panel p-1 shadow-panel animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear selection"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground"
          >
            <X />
          </Button>
          <span
            aria-live="polite"
            className="px-1.5 text-[13px] font-medium whitespace-nowrap text-foreground tabular-nums"
          >
            {count}
            <span className="max-sm:sr-only"> selected</span>
          </span>
          {count < total && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
              className="text-muted-foreground hover:text-foreground max-sm:px-2"
            >
              Select all
            </Button>
          )}
          <span
            aria-hidden
            className="mx-1 h-5 w-px shrink-0 bg-border max-sm:hidden"
          />

          <BarButton
            label={allStarred ? "Unstar" : "Star"}
            onClick={() => star.mutate({ data: { ids, starred: !allStarred } })}
          >
            {allStarred ? <StarOff /> : <Star />}
          </BarButton>

          {/* A folder holds one space's drawings, so a mixed selection can't move */}
          {space && (
            <MoveToFolderMenu
              space={space}
              selected={selected}
              onMove={(folderId) => {
                const moving = selected.filter((d) => d.folderId !== folderId)
                // Same folder is a no-op: the server would bump updatedAt
                if (moving.length > 0)
                  moveToFolder.mutate({
                    data: { ids: moving.map((d) => d.id), folderId },
                  })
                onClear()
              }}
            />
          )}

          {teamEnabled && space === "private" && (
            <BarButton
              label="Move to Team"
              onClick={() => setConfirmTeam(true)}
            >
              <Users />
            </BarButton>
          )}

          <BarButton label="Export" onClick={onExport} disabled={exporting}>
            <Download />
          </BarButton>

          <BarButton
            label="Move to trash"
            onClick={() => {
              trash(selected)
              onClear()
            }}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </BarButton>

          <AlertDialog open={confirmTeam} onOpenChange={setConfirmTeam}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Move {countDrawings(count)} to Team?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  All members can see and edit them. You can't move them back to
                  Private.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant="primary"
                  onClick={() => {
                    moveToTeam.mutate({ data: ids })
                    setConfirmTeam(false)
                    onClear()
                  }}
                >
                  Move to Team
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </>
  )
}

// Icon-only below sm; the label stays the accessible name either way.
function BarButton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("text-[13px] max-sm:px-2", className)}
      {...props}
    >
      {children}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  )
}

/** Folder picker for the selection's space, by path; "No folder" first. */
function MoveToFolderMenu({
  space,
  selected,
  onMove,
}: {
  space: Drawing["space"]
  selected: Drawing[]
  onMove: (folderId: string | null) => void
}) {
  const { data: folders = [] } = useQuery(foldersQueryOptions())
  const options = useMemo(() => {
    const inSpace = folders.filter((folder) => folder.space === space)
    const paths = folderPaths(inSpace)
    return inSpace
      .map((folder) => ({ id: folder.id, path: paths.get(folder.id) ?? "" }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [folders, space])
  // The folder every selected drawing is already in, if they share one
  const current = selected.every((d) => d.folderId === selected[0]?.folderId)
    ? (selected[0]?.folderId ?? null)
    : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-[13px] max-sm:px-2"
          />
        }
      >
        <FolderInput />
        <span className="sr-only sm:not-sr-only">Move to folder</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        className="max-h-72 max-w-xs overflow-y-auto"
      >
        <DropdownMenuItem
          disabled={current === null}
          onClick={() => onMove(null)}
        >
          No folder
        </DropdownMenuItem>
        {options.length > 0 && <DropdownMenuSeparator />}
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            disabled={current === option.id}
            onClick={() => onMove(option.id)}
          >
            <span className="truncate">{option.path}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
