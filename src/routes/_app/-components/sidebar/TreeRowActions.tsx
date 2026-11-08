import {
  Download,
  FilePlus,
  MoreHorizontal,
  Pencil,
  Star,
  StarOff,
  Trash2,
  Users,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

type TreeRowActionsProps = {
  isRenaming: boolean
  onStartRename: () => void
  menuFinalFocus: () => boolean | undefined
  // Tier-1 destructive: fires immediately — no confirm dialog. The caller
  // shows the undo toast (trash is the safety net).
  onTrash: () => void
  // Folder rows offer creating a drawing scoped to that folder
  onCreateDrawing?: () => void
  // Drawing rows offer starring; the label follows current state
  starred?: boolean
  onToggleStar?: () => void
  // Private rows offer the move to Team (opens its confirm)
  onMoveToTeam?: () => void
  // Drawing rows offer a download as an `.excalidraw` file
  onExport?: () => void
}

// Callers must wrap the row in `group/tree-row` on whichever element should
// scope the hover/focus reveal (the SidebarMenuItem for a drawing, the inner
// row div for a folder so children in CollapsibleContent don't count).
export function TreeRowActions({
  isRenaming,
  onStartRename,
  menuFinalFocus,
  onTrash,
  onCreateDrawing,
  starred,
  onToggleStar,
  onMoveToTeam,
  onExport,
}: TreeRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            className={cn(
              "text-muted-foreground/30 md:opacity-0 group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100 data-popup-open:opacity-100 [&>svg]:size-auto",
              // Use `invisible` (not `hidden`) so the trigger stays in
              // layout while renaming — otherwise the closing popup
              // loses its anchor and flashes at viewport (0, 0)
              isRenaming && "invisible pointer-events-none",
            )}
            // Stop pointer/click from bubbling to ancestor triggers such as
            // FolderItem's CollapsibleTrigger
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <MoreHorizontal className="h-3.5! w-3.5!" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        finalFocus={menuFinalFocus}
        // Portaled, but still a React child of the row — clicks bubble
        // through the React tree to ancestor triggers such as FolderItem's
        // CollapsibleTrigger unless fenced here
        onClick={(e) => e.stopPropagation()}
      >
        {onCreateDrawing && (
          <DropdownMenuItem onClick={onCreateDrawing}>
            <FilePlus className="mr-2 h-4 w-4" />
            New drawing
          </DropdownMenuItem>
        )}
        {onToggleStar &&
          (starred ? (
            <DropdownMenuItem onClick={onToggleStar}>
              <StarOff className="mr-2 h-4 w-4" />
              Unstar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onToggleStar}>
              <Star className="mr-2 h-4 w-4" />
              Star
            </DropdownMenuItem>
          ))}
        <DropdownMenuItem onClick={onStartRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </DropdownMenuItem>
        {onExport && (
          <DropdownMenuItem onClick={onExport}>
            <Download className="mr-2 h-4 w-4" />
            Export .excalidraw
          </DropdownMenuItem>
        )}
        {onMoveToTeam && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onMoveToTeam}>
              <Users className="mr-2 h-4 w-4" />
              Move to Team
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onTrash}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Move to trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
