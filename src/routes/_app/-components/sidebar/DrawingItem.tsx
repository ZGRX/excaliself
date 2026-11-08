import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { File } from "lucide-react"
import { LiveCountChip } from "@/components/live-badge"
import { Input } from "@/components/ui/input"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { useLiveDrawing } from "@/features/collab/queries"
import { exportDrawing } from "@/features/drawings/export"
import {
  useRenameDrawing,
  useToggleStarDrawing,
  useTrashDrawing,
} from "@/features/drawings/mutations"
import { useInlineRename } from "@/hooks/use-inline-rename"
import { cn } from "@/lib/utils"
import { useMoveToTeamDialog } from "../MoveToTeamDialog"
import { TreeRowActions } from "./TreeRowActions"
import type { Drawing } from "./tree"
import { useSidebarDnD } from "./use-sidebar-dnd"

type DrawingItemProps = {
  drawing: Drawing
}

export function DrawingItem({ drawing }: DrawingItemProps) {
  const navigate = useNavigate()
  // Non-strict: on Home no drawing is open and there is no $id param
  const { id: currentDrawingId } = useParams({ strict: false })
  const { dragItem, onDragStart, onDragEnd } = useSidebarDnD()

  const isDragging = dragItem?.id === drawing.id
  const isActive = drawing.id === currentDrawingId

  const renameMutation = useRenameDrawing()
  const rename = useInlineRename({
    onSubmit: (newName) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === drawing.name) return
      renameMutation.mutate({
        data: { id: drawing.id, updateData: { name: trimmed } },
      })
    },
  })

  const trashDrawing = useTrashDrawing()
  const starMutation = useToggleStarDrawing()
  const live = useLiveDrawing(drawing.id)
  const { requestMoveToTeam } = useMoveToTeamDialog()

  const handleTrash = () => {
    // Instant, no confirm — the mutation shows the undo toast itself
    trashDrawing(drawing)
    // Trashing the open drawing lands on Home, never on a dead URL
    if (drawing.id === currentDrawingId) navigate({ to: "/draw" })
  }

  const content = (
    <>
      <File
        className={cn(
          "h-3.25! w-3.25! shrink-0 transition-colors",
          isActive ? "text-iris" : "text-muted-foreground/60",
        )}
      />
      {rename.isRenaming ? (
        <Input {...rename.inputProps} className="h-5 rounded px-1 text-sm" />
      ) : (
        <>
          <span className="truncate transition-colors">{drawing.name}</span>
          <LiveCountChip
            live={live}
            className="ml-auto animate-in fade-in-0 duration-200"
          />
        </>
      )}
    </>
  )

  return (
    <SidebarMenuItem
      className={cn("group/tree-row", isDragging && "opacity-50")}
      draggable
      onDragStart={onDragStart({
        type: "drawing",
        id: drawing.id,
        space: drawing.space,
      })}
      onDragEnd={onDragEnd}
    >
      <SidebarMenuButton
        render={
          rename.isRenaming ? undefined : (
            <Link
              to="/draw/$id"
              params={{ id: drawing.id }}
              draggable={false}
            />
          )
        }
        isActive={isActive}
        className={cn(
          // Always reserve the row action's slot so long names and the live
          // chip never run under it when it's revealed.
          "h-auto cursor-pointer gap-1.5 px-2 py-1.5 pr-7! text-[13px] active:cursor-grabbing [&>svg]:size-auto",
          "data-[active=true]:bg-iris-muted data-[active=true]:font-medium data-[active=true]:text-iris-strong data-[active=true]:shadow-row-active",
          rename.isRenaming && "pr-3!",
        )}
      >
        {content}
      </SidebarMenuButton>

      <TreeRowActions
        isRenaming={rename.isRenaming}
        starred={drawing.starred}
        onToggleStar={() =>
          starMutation.mutate({
            data: { id: drawing.id, starred: !drawing.starred },
          })
        }
        onStartRename={() => rename.start(drawing.name)}
        menuFinalFocus={rename.menuFinalFocus}
        onTrash={handleTrash}
        onExport={() => exportDrawing(drawing)}
        onMoveToTeam={
          requestMoveToTeam && drawing.space === "private"
            ? () =>
                requestMoveToTeam(
                  { type: "drawing", id: drawing.id },
                  drawing.name,
                )
            : undefined
        }
      />
    </SidebarMenuItem>
  )
}
