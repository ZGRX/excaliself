import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { File, Folder, PanelLeft, Plus, Search, Trash2 } from "lucide-react"
import { useEffect, useMemo } from "react"
import { Mark } from "@/components/identity"
import { KEYCAP_CLASS } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar"
import type { Space } from "@/db/schema"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { useIsApplePlatform } from "@/hooks/use-is-apple-platform"
import { cn } from "@/lib/utils"
import { useActiveSpace } from "../ActiveSpace"
import { useCommandPalette } from "../CommandPalette"
import { useCreateDialog } from "../CreateDialog"
import { GitHubStarPrompt } from "./GitHubStarPrompt"
import { SidebarNav, SidebarNavItem } from "./SidebarNav"
import { type SidebarUser, SidebarUserMenu } from "./SidebarUserMenu"
import { SpaceSegments } from "./SpaceSegments"
import { StarredSection } from "./StarredSection"
import { useSpaceSwipe } from "./space-gestures"
import { TreeNodeItem } from "./TreeNodeItem"
import {
  buildTree,
  type Drawing,
  type Folder as FolderModel,
  treeNodeKey,
} from "./tree"
import { SidebarDnDProvider, useSidebarDnD } from "./use-sidebar-dnd"

const bySpace = <T extends { space: Space }>(rows: T[]) => ({
  private: rows.filter((row) => row.space === "private"),
  team: rows.filter((row) => row.space === "team"),
})

export function DrawSidebar({ user }: { user: SidebarUser }) {
  const { data: drawings = [] } = useQuery(drawingsQueryOptions())
  const { data: folders = [] } = useQuery(foldersQueryOptions())
  const { activeSpace } = useActiveSpace()
  const { openCreateDrawingDialog } = useCreateDialog()
  const { openCommandPalette } = useCommandPalette()
  const isApplePlatform = useIsApplePlatform()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return
      e.preventDefault()
      openCreateDrawingDialog()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openCreateDrawingDialog])

  const foldersById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  )

  const drawingsBySpace = useMemo(() => bySpace(drawings), [drawings])
  const foldersBySpace = useMemo(() => bySpace(folders), [folders])

  return (
    <SidebarDnDProvider drawings={drawings} foldersById={foldersById}>
      {/* p-0 drops the inset variant's outer padding so the sidebar content
          spans the full 240px, flush with the chrome — per the prototype. */}
      <Sidebar collapsible="offcanvas" variant="inset" className="p-0">
        <SidebarHeader className="gap-0 px-2 pt-2 pb-0.5">
          {/* The link's and toggle's click-target padding is pulled out of
              the layout flow (-my) so the header keeps the mockup's height. */}
          <div className="flex items-center px-2 py-1.5">
            <Link
              to="/draw"
              className="-mx-1 -my-0.5 flex items-center gap-2.5 rounded-md px-1 py-0.5 focus-visible:bg-sidebar-accent focus-visible:outline-none"
            >
              <Mark className="h-5 w-auto shrink-0 text-iris" />
              <span className="text-sm font-semibold tracking-[-0.01em] text-foreground">
                Excaliself
              </span>
            </Link>
            <SidebarToggle />
          </div>
        </SidebarHeader>

        <div className="px-2 pt-1 pb-1.5">
          <button
            type="button"
            data-tour="new-drawing"
            onClick={() => openCreateDrawingDialog()}
            className={cn(
              KEYCAP_CLASS,
              "flex w-full items-center justify-center gap-1.5 py-2 text-[13px] font-medium",
            )}
          >
            <Plus className="h-3 w-3 text-iris" strokeWidth={2.5} />
            New drawing
            <Kbd>N</Kbd>
          </button>
        </div>

        {/* Styled like a search field but it's a palette trigger — no inline
            tree filter remains (spec §2.3). */}
        <div className="px-2 pb-1">
          <button
            type="button"
            data-tour="search"
            onClick={openCommandPalette}
            className="flex w-full items-center gap-2 rounded-md bg-well px-2.5 py-2 text-[13px] text-muted-foreground/70 shadow-well transition-colors hover:bg-well-hover hover:text-muted-foreground focus-visible:bg-well-hover focus-visible:outline-none"
          >
            <Search
              className="h-3.25 w-3.25 shrink-0 text-muted-foreground/50"
              strokeWidth={2.5}
            />
            <span className="flex-1 truncate text-left">Search</span>
            <Kbd>{isApplePlatform ? "⌘K" : "Ctrl K"}</Kbd>
          </button>
        </div>

        {activeSpace && <SpaceSegments activeSpace={activeSpace} />}

        <SidebarNav />

        {activeSpace ? (
          <SpaceTrack
            activeSpace={activeSpace}
            drawingsBySpace={drawingsBySpace}
            foldersBySpace={foldersBySpace}
          />
        ) : (
          // Solo instance: today's sidebar, one scroll region, no track.
          <SidebarContent className="gap-0 pt-0.5 [scrollbar-width:none]">
            <SpaceBody space="private" drawings={drawings} folders={folders} />
          </SidebarContent>
        )}

        <SidebarFooter className="gap-0 p-2">
          {user.isAdmin && (
            <GitHubStarPrompt
              userId={user.id}
              createdAt={user.createdAt}
              drawingCount={drawings.length}
            />
          )}
          {/* Pinned below the scroll region — Trash stays reachable no
              matter how tall the tree grows (spec §2.3). */}
          <SidebarMenu className="gap-0">
            <SidebarNavItem to="/trash" label="Trash" icon={Trash2} />
          </SidebarMenu>
          <SidebarUserMenu user={user} />
        </SidebarFooter>
      </Sidebar>
    </SidebarDnDProvider>
  )
}

function SidebarToggle() {
  const { toggleSidebar } = useSidebar()
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Toggle Sidebar"
      className="-m-1.5 ml-auto rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-muted-foreground focus-visible:bg-sidebar-accent focus-visible:outline-none"
    >
      <PanelLeft className="h-3.5 w-3.5" />
    </button>
  )
}

/**
 * Variant A's track: one pane per space side by side, sliding to the active
 * one. A horizontal swipe over it switches space.
 */
function SpaceTrack({
  activeSpace,
  drawingsBySpace,
  foldersBySpace,
}: {
  activeSpace: Space
  drawingsBySpace: Record<Space, Drawing[]>
  foldersBySpace: Record<Space, FolderModel[]>
}) {
  const { setActiveSpace } = useActiveSpace()
  const onWheel = useSpaceSwipe(setActiveSpace)

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" onWheel={onWheel}>
      <div
        className={cn(
          "flex h-full w-[200%] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          activeSpace === "team" && "-translate-x-1/2",
        )}
      >
        {(["private", "team"] as const).map((space) => (
          // Each pane scrolls on its own; the hidden one is out of reach.
          <div
            key={space}
            inert={space !== activeSpace}
            aria-hidden={space !== activeSpace}
            className="flex h-full w-1/2 min-w-0 flex-col overflow-auto pt-0.5 [scrollbar-width:none]"
          >
            <SpaceBody
              space={space}
              drawings={drawingsBySpace[space]}
              folders={foldersBySpace[space]}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// Starred and the tree share one scroll region — a fixed starred list would
// otherwise squeeze the tree out of view as stars grow.
function SpaceBody({
  space,
  drawings,
  folders,
}: {
  space: Space
  drawings: Drawing[]
  folders: FolderModel[]
}) {
  const { dropTarget, onDragOver, onDragLeave, onDrop } = useSidebarDnD()
  const { openCreateDrawingDialog, openCreateFolderDialog } = useCreateDialog()
  const tree = useMemo(() => buildTree(folders, drawings), [folders, drawings])
  const target = { type: "root", space } as const

  return (
    <>
      <StarredSection drawings={drawings} />

      <div className="flex items-center justify-between pt-2 pb-0.5 pr-3 pl-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
          Drawings
        </span>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {drawings.length}
          </span>
          <CreateMenu
            onCreateDrawing={() => openCreateDrawingDialog(undefined, space)}
            onCreateFolder={() => openCreateFolderDialog(space)}
          />
        </div>
      </div>

      <div className="px-2">
        <div
          className={cn(
            "min-h-50 rounded-md pb-4 transition-colors",
            dropTarget?.type === "root" &&
              dropTarget.space === space &&
              "bg-iris-muted ring-2 ring-iris-ring",
          )}
          onDragOver={onDragOver(target)}
          onDragLeave={onDragLeave}
          onDrop={onDrop(target)}
        >
          <SidebarMenu className="gap-0">
            {tree.map((node) => (
              <TreeNodeItem key={treeNodeKey(node)} node={node} />
            ))}
          </SidebarMenu>
        </div>
      </div>
    </>
  )
}

function CreateMenu({
  onCreateDrawing,
  onCreateFolder,
}: {
  onCreateDrawing: () => void
  onCreateFolder: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="-m-1 rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-muted-foreground focus-visible:bg-sidebar-accent focus-visible:text-muted-foreground focus-visible:outline-none"
          />
        }
      >
        <Plus className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" finalFocus={false}>
        <DropdownMenuItem onClick={onCreateDrawing}>
          <File className="mr-2 h-4 w-4" />
          New drawing
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateFolder}>
          <Folder className="mr-2 h-4 w-4" />
          New folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
