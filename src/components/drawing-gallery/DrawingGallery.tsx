import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { createClientOnlyFn } from "@tanstack/react-start"
import {
  Folder as FolderIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { LiveAvatarStack } from "@/components/live-badge"
import { SpaceLabel } from "@/components/space-label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { useLiveDrawing } from "@/features/collab/queries"
import {
  type Drawing,
  drawingSceneQueryOptions,
} from "@/features/drawings/queries"
import type { Folder } from "@/features/folders/queries"
import { useDelayedVisible } from "@/hooks/use-delayed-visible"
import { formatAgo } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import { compareDrawings, DEFAULT_SORT, type SortOrder } from "./browse"

// Shared with TrashGallery so browse and trash stay one grid language.
export const GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"

/** The card's resting frame (the Etched card recipe: top-lit gradient over
 * a hairline border); interactive cards layer hover/active on top. */
export const CARD_FRAME_CLASS =
  "relative flex flex-col overflow-hidden rounded-card border border-card-border bg-gradient-to-b from-card-from to-card-to shadow-card"

/** The interactive lift: the border sharpens and the shadow grows. */
export const CARD_HOVER_CLASS =
  "transition-[box-shadow,border-color,scale] duration-150 hover:border-card-border-hover hover:shadow-card-hover"

const DEFAULT_SKELETON_COUNT = 8

// Client-only: @excalidraw/excalidraw is not server-safe, and this keeps it
// out of the server bundle and the gallery's initial chunk
const loadPreview = createClientOnlyFn(() => import("./preview"))

/**
 * The app's one drawing grid: preview cards sorted newest-edited first, with
 * a delayed skeleton while loading and an `empty` slot for the zero state.
 * Home caps it with `limit`; browse renders it whole; trash will reuse it.
 */
export function DrawingGallery({
  drawings,
  folders,
  isPending,
  limit,
  sort = DEFAULT_SORT,
  query,
  spaceLabels = false,
  loadingLabel,
  onTrash,
  empty,
}: {
  /** Any order — the server sorts, but autosave patches cache rows in place
   * without reordering, so the gallery sorts for itself. */
  drawings: Drawing[]
  /** When provided, cards carry folder attribution (Home and the All view —
   * scoped views omit it). */
  folders?: Folder[]
  isPending: boolean
  /** Cap applied after sorting (Home's 8 recents). */
  limit?: number
  /** Grid order — browse's sort dropdown; everywhere else keeps Recent. */
  sort?: SortOrder
  /** The browse search, so title matches sort ahead of scene-text matches. */
  query?: string
  /** Cards say which space they live in: search results that span both. */
  spaceLabels?: boolean
  /** Accessible name for the loading grid. */
  loadingLabel: string
  /** Card overflow action "Move to trash" (spec §5.11): tier-1 destructive,
   * identical everywhere — pages wire `useTrashDrawing`, which removes the
   * card optimistically and shows the undo toast itself. No confirm dialog. */
  onTrash: (drawing: Drawing) => void
  /** Rendered when loading settles on zero drawings. */
  empty: React.ReactNode
}) {
  // Spec §4.3: skeletons appear only after ~150 ms — cache hits render
  // instantly, and loads that beat the grace period never flash one.
  const showSkeleton = useDelayedVisible(isPending)

  const sorted = useMemo(() => {
    const ordered = [...drawings].sort(compareDrawings(sort, query))
    return limit === undefined ? ordered : ordered.slice(0, limit)
  }, [drawings, limit, sort, query])

  const foldersById = useMemo(
    () => new Map((folders ?? []).map((folder) => [folder.id, folder])),
    [folders],
  )

  if (isPending) {
    return showSkeleton ? (
      <LoadingGrid
        label={loadingLabel}
        count={limit ?? DEFAULT_SKELETON_COUNT}
      />
    ) : null
  }

  if (sorted.length === 0) return <>{empty}</>

  return (
    // Mount fade so the swap from skeletons isn't a single-frame pop.
    // Reduced-motion keeps it: opacity-only is already the gentle form.
    <div className={cn(GRID_CLASS, "animate-in fade-in-0 duration-200")}>
      {sorted.map((drawing) => (
        <DrawingCard
          key={drawing.id}
          drawing={drawing}
          folder={
            drawing.folderId ? foldersById.get(drawing.folderId) : undefined
          }
          spaceLabel={spaceLabels}
          onTrash={() => onTrash(drawing)}
        />
      ))}
    </div>
  )
}

// Placeholder cards mirror DrawingCard's frame so the loaded grid lands on
// the same footprint instead of popping into empty space.
export function LoadingGrid({
  label,
  count,
}: {
  label: string
  count: number
}) {
  return (
    <div role="status" aria-label={label} className={GRID_CLASS}>
      {Array.from({ length: count }, (_, i) => (
        <div
          // Static list — index keys are fine
          key={i}
          className={CARD_FRAME_CLASS}
        >
          <Skeleton className="aspect-[4/3] rounded-none border-b border-hairline motion-reduce:animate-none" />
          <div className="flex flex-col gap-1.5 px-3 py-2.5">
            <Skeleton className="h-3.5 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Anchors can't nest, and the attribution chip is itself a link to the
// folder page (spec §5.3) — so the card is a div with a stretched link to
// the drawing, and the chip sits above it on its own z-layer.
function DrawingCard({
  drawing,
  folder,
  spaceLabel,
  onTrash,
}: {
  drawing: Drawing
  folder?: Folder
  spaceLabel: boolean
  onTrash: () => void
}) {
  // Per card so a poll result re-renders only the changed card.
  const live = useLiveDrawing(drawing.id)

  return (
    <div
      className={cn(
        CARD_FRAME_CLASS,
        CARD_HOVER_CLASS,
        "group active:scale-[0.99]",
      )}
    >
      <Link
        to="/draw/$id"
        params={{ id: drawing.id }}
        aria-label={drawing.name}
        className="absolute inset-0 rounded-card"
      />
      {/* `relative` paints this above the stretched link; pointer-events-none
          lets clicks reach it. */}
      <div className="pointer-events-none relative aspect-[4/3] overflow-hidden border-b border-hairline">
        <Preview drawing={drawing} />
        <LiveAvatarStack
          live={live}
          className="absolute bottom-2 left-2 animate-in fade-in-0 zoom-in-95 duration-200"
        />
        {/* On the preview, not the footer: the footer has no room left */}
        {spaceLabel && (
          <SpaceLabel
            space={drawing.space}
            className="absolute top-2 right-2 h-5 rounded-[5px] bg-keycap-from px-1.5 text-[11px] font-medium text-muted-foreground shadow-keycap"
          />
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {drawing.space === "team" && (
          <CreatorAvatar creator={drawing.creator} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-foreground">
            {drawing.name}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {folder && (
              <>
                <Link
                  to="/folder/$id"
                  params={{ id: folder.id }}
                  className="relative z-10 flex min-w-0 items-center gap-1 transition-colors duration-150 hover:text-foreground"
                >
                  <FolderIcon className="h-3 w-3 shrink-0 fill-iris/70 text-iris" />
                  <span className="truncate">{folder.name}</span>
                </Link>
                <span aria-hidden className="text-muted-foreground/50">
                  ·
                </span>
              </>
            )}
            {/* Server and client can straddle a minute boundary */}
            <span suppressHydrationWarning className="shrink-0">
              {formatAgo(drawing.updatedAt)}
            </span>
          </span>
        </div>
        <CardActions name={drawing.name} onTrash={onTrash} />
      </div>
    </div>
  )
}

/**
 * Who made a Team drawing, as a byline face in the footer. The Live stack
 * ("who is here now") sits on the preview instead, in cursor colors, so the
 * two never meet. A deleted creator reads "Former member".
 */
function CreatorAvatar({ creator }: { creator: Drawing["creator"] }) {
  const name = creator?.name ?? "Former member"
  return (
    <Tooltip>
      {/* z-10 lifts it above the stretched link so hover reaches it */}
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Created by ${name}`}
            className="relative z-10 shrink-0 rounded-full"
          />
        }
      >
        {creator ? (
          <UserAvatar initials={creator.initials} image={creator.image} />
        ) : (
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/70"
          >
            <UserRound className="h-3.5 w-3.5" />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}

// The card's overflow menu — z-layered above the stretched drawing link,
// hidden until hover/focus when the primary pointer is a mouse. Gated on
// pointer capability, not viewport width: a touch-only tablet at desktop
// width has no hover to reveal it, so there it stays visible.
function CardActions({ name, onTrash }: { name: string; onTrash: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Actions for ${name}`}
            className="relative z-10 -mr-1.5 shrink-0 rounded-md p-1 text-muted-foreground/50 transition-[color,background-color,opacity] duration-150 hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100 pointer-fine:data-popup-open:opacity-100"
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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

/** True once `ref` comes near the viewport, and from then on. */
function useSeen(ref: React.RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (seen || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin: "200px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, seen])
  return seen
}

/** A card's scene, rendered. The list has no scenes; each card fetches its own once seen. */
export function Preview({
  drawing,
}: {
  drawing: Pick<Drawing, "id" | "name" | "updatedAt">
}) {
  const name = drawing.name
  const frameRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const seen = useSeen(frameRef)
  const scene = useQuery({
    ...drawingSceneQueryOptions(drawing.id, drawing.updatedAt),
    enabled: seen,
  })
  const [state, setState] = useState<"pending" | "ready" | "empty">("pending")

  const data = scene.data
  const failed = scene.isError
  useEffect(() => {
    if (failed) {
      setState("empty")
      return
    }
    if (data === undefined) return
    let cancelled = false
    loadPreview()
      .then(({ renderPreviewSvg }) => renderPreviewSvg(data ?? ""))
      .then((svg) => {
        if (cancelled) return
        if (!svg || !containerRef.current) {
          setState("empty")
          return
        }
        svg.style.width = "100%"
        svg.style.height = "100%"
        containerRef.current.replaceChildren(svg)
        setState("ready")
      })
      // A failed render is contained to this card's placeholder
      .catch(() => {
        if (!cancelled) setState("empty")
      })
    return () => {
      cancelled = true
    }
  }, [data, failed])

  return (
    // pointer-events-none: this div is positioned and DOM-later than the
    // card's stretched link, so it would otherwise paint above the link and
    // swallow clicks on the whole preview area.
    <div ref={frameRef} className="pointer-events-none relative h-full w-full">
      <div
        ref={containerRef}
        role="img"
        aria-label={state === "ready" ? `Preview of ${name}` : undefined}
        // Reduced-motion keeps the fade: opacity-only is already the gentle form.
        //
        // In dark chrome, element colors assume a light canvas (default stroke
        // is near-black), so the export is re-tinted with Excalidraw's own
        // THEME_FILTER — the same filter its dark canvas and
        // exportWithDarkMode apply.
        className={cn(
          "h-full w-full p-2 transition-opacity duration-200 ease-out [&_svg]:h-full [&_svg]:w-full [&_svg]:object-contain",
          "dark:[filter:invert(93%)_hue-rotate(180deg)]",
          state === "ready" ? "opacity-100" : "opacity-0",
        )}
      />
      {state === "empty" && (
        <div
          role="img"
          aria-label="No preview"
          className="absolute inset-0 flex items-center justify-center"
        >
          <Pencil className="h-5 w-5 text-muted-foreground/30" />
        </div>
      )}
    </div>
  )
}
