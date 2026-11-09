// Comment pins over the canvas, the open thread, a new thread's draft, and
// the comments panel. Pins are DOM, never scene elements, so they stay out of
// exports, the Room, and undo.

import { CaptureUpdateAction } from "@excalidraw/excalidraw"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useQuery } from "@tanstack/react-query"
import {
  CheckIcon,
  MessageSquarePlusIcon,
  UnlinkIcon,
  XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  type AnchorElement,
  anchorAt,
  type NewAnchor,
  pinPosition,
} from "@/features/comments/anchor"
import { useMarkRead, useStartThread } from "@/features/comments/mutations"
import {
  type CommentThread,
  commentThreadsQueryOptions,
} from "@/features/comments/queries"
import { formatAgo } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import { CommentComposer } from "./CommentComposer"
import {
  authorName,
  CommentThreadCard,
  PersonAvatar,
} from "./CommentThreadCard"

const COMMENT_TOOL = { type: "custom", customType: "comment" } as const
/** Screen pixels around a shape that still count as a click on it. */
const HIT_TOLERANCE_PX = 6
const CARD_WIDTH = 320
/** The panel's `w-80`. */
const PANEL_WIDTH = 320
const SHOW_RESOLVED_KEY = "excaliself:comments:show-resolved"

type View = {
  scrollX: number
  scrollY: number
  zoom: number
  width: number
  height: number
  elements: readonly AnchorElement[]
  placing: boolean
}

/** The canvas's scroll, zoom, size, and elements, read once per frame. */
function useCanvasView(api: ExcalidrawImperativeAPI | null): View | null {
  const [view, setView] = useState<View | null>(null)
  useEffect(() => {
    if (!api) return
    let frame = 0
    const read = () => {
      frame = 0
      const state = api.getAppState()
      const next: View = {
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        zoom: state.zoom.value,
        width: state.width,
        height: state.height,
        // The same array until the scene changes.
        elements: api.getSceneElementsIncludingDeleted(),
        placing:
          state.activeTool.type === "custom" &&
          state.activeTool.customType === COMMENT_TOOL.customType,
      }
      setView((current) =>
        current &&
        (Object.keys(next) as (keyof View)[]).every(
          (key) => current[key] === next[key],
        )
          ? current
          : next,
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    const unsubscribe = [api.onChange(schedule), api.onScrollChange(schedule)]
    return () => {
      cancelAnimationFrame(frame)
      for (const off of unsubscribe) off()
    }
  }, [api])
  return view
}

function readShowResolved(): boolean {
  try {
    return localStorage.getItem(SHOW_RESOLVED_KEY) === "true"
  } catch {
    return false
  }
}

function useShowResolved() {
  const [showResolved, setShowResolved] = useState(readShowResolved)
  const update = useCallback((next: boolean) => {
    setShowResolved(next)
    try {
      localStorage.setItem(SHOW_RESOLVED_KEY, String(next))
    } catch {
      // A private window keeps it for this tab only.
    }
  }, [])
  return [showResolved, update] as const
}

/** Open threads by latest activity, then resolved ones. */
function sortForList(threads: CommentThread[]) {
  return [...threads].sort((a, b) => {
    if ((a.resolvedAt === null) !== (b.resolvedAt === null))
      return a.resolvedAt === null ? -1 : 1
    return (
      new Date(b.lastActivityAt).getTime() -
      new Date(a.lastActivityAt).getTime()
    )
  })
}

type Props = {
  drawingId: string
  excalidrawAPI: ExcalidrawImperativeAPI | null
  readOnly: boolean
  panelOpen: boolean
  onPanelOpenChange: (open: boolean) => void
}

export function CommentsLayer({
  drawingId,
  excalidrawAPI,
  readOnly,
  panelOpen,
  onPanelOpenChange,
}: Props) {
  const { data: threads = [] } = useQuery(commentThreadsQueryOptions(drawingId))
  const view = useCanvasView(excalidrawAPI)
  const [showResolved, setShowResolved] = useShowResolved()
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NewAnchor | null>(null)
  const start = useStartThread(drawingId)
  const markRead = useMarkRead(drawingId)

  const elementsById = useMemo(
    () => new Map((view?.elements ?? []).map((el) => [el.id, el])),
    [view?.elements],
  )
  const placing = view?.placing ?? false
  const openThread = threads.find((thread) => thread.id === openThreadId)

  const startPlacing = useCallback(() => {
    setOpenThreadId(null)
    setDraft(null)
    excalidrawAPI?.setActiveTool(COMMENT_TOOL)
  }, [excalidrawAPI])

  // A click in comment mode drops the draft there; any other click on the
  // canvas closes what is open.
  useEffect(() => {
    if (!excalidrawAPI) return
    return excalidrawAPI.onPointerDown((tool, pointerDownState) => {
      if (
        tool.type !== "custom" ||
        tool.customType !== COMMENT_TOOL.customType
      ) {
        setOpenThreadId(null)
        setDraft(null)
        return
      }
      const { zoom } = excalidrawAPI.getAppState()
      setDraft(
        anchorAt(
          pointerDownState.origin,
          excalidrawAPI.getSceneElements(),
          HIT_TOLERANCE_PX / zoom.value,
        ),
      )
      setOpenThreadId(null)
      // After the release, so this press doesn't start a selection box.
      window.addEventListener(
        "pointerup",
        () => excalidrawAPI.setActiveTool({ type: "selection" }),
        { once: true },
      )
    })
  }, [excalidrawAPI])

  // Escape leaves comment mode and closes what is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      setOpenThreadId(null)
      setDraft(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Opening a thread reads it, and so does a new comment while it is open.
  const openUnread = openThread?.unread === true
  const markThreadRead = markRead.mutate
  useEffect(() => {
    if (openThreadId && openUnread) markThreadRead(openThreadId)
  }, [openThreadId, openUnread, markThreadRead])

  // The thread was deleted (here or elsewhere).
  useEffect(() => {
    if (openThreadId && !openThread && !start.isPending) setOpenThreadId(null)
  }, [openThreadId, openThread, start.isPending])

  if (!view) return null

  const toScreen = (point: { x: number; y: number }) => ({
    left: (point.x + view.scrollX) * view.zoom,
    top: (point.y + view.scrollY) * view.zoom,
  })
  const onScreen = ({ left, top }: { left: number; top: number }) =>
    left > -40 && top > -40 && left < view.width + 40 && top < view.height + 40

  /**
   * A card beside its pin, inside the canvas and clear of the panel. In the
   * lower half it grows up from the pin, so it never gets squeezed.
   */
  const cardStyle = (pin: { left: number; top: number }) => {
    const right = view.width - 8 - (panelOpen ? PANEL_WIDTH + 12 : 0)
    const width = Math.min(CARD_WIDTH, view.width - 16)
    const left =
      pin.left + 24 + width <= right
        ? pin.left + 24
        : Math.max(8, pin.left - 24 - width)
    if (pin.top > view.height / 2) {
      const bottom = Math.max(8, view.height - pin.top - 8)
      return { left, bottom, width, maxHeight: view.height - bottom - 8 }
    }
    const top = Math.max(8, pin.top - 24)
    return { left, top, width, maxHeight: view.height - top - 8 }
  }

  const focusThread = (thread: CommentThread) => {
    if (!excalidrawAPI) return
    const point = pinPosition(thread, elementsById)
    excalidrawAPI.updateScene({
      appState: {
        scrollX: view.width / 2 / view.zoom - point.x,
        scrollY: view.height / 2 / view.zoom - point.y,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    setDraft(null)
    setOpenThreadId(thread.id)
  }

  const shown = threads.filter(
    (thread) =>
      thread.resolvedAt === null || showResolved || thread.id === openThreadId,
  )
  const openPin = openThread && toScreen(pinPosition(openThread, elementsById))
  const draftPin = draft && toScreen(draft)

  return (
    <>
      {/* z-[3]: above the canvas, below Excalidraw's menus (z 4). */}
      <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
        {shown.map((thread) => {
          const position = pinPosition(thread, elementsById)
          const pin = toScreen(position)
          if (!onScreen(pin)) return null
          return (
            <ThreadPin
              key={thread.id}
              thread={thread}
              detached={position.detached}
              active={thread.id === openThreadId}
              style={pin}
              onClick={() => {
                setDraft(null)
                setOpenThreadId(thread.id === openThreadId ? null : thread.id)
              }}
            />
          )
        })}
        {draftPin && (
          <span
            aria-hidden
            className="absolute size-7 -translate-y-full rounded-full rounded-bl-none border-2 border-white bg-iris shadow-md"
            style={draftPin}
          />
        )}
      </div>

      {placing && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
          <p className="rounded-full bg-popover px-3 py-1.5 text-xs shadow-md ring-1 ring-border">
            Click a spot or a shape to comment. Esc to cancel.
          </p>
        </div>
      )}

      {openThread && openPin && (
        <div
          // Above the panel: a narrow canvas has no room beside it.
          className="absolute z-20 flex overflow-hidden rounded-lg bg-popover shadow-lg ring-1 ring-border"
          style={cardStyle(openPin)}
        >
          <div className="min-w-0 flex-1">
            <CommentThreadCard
              // A new thread gets an empty reply box, not the last one's draft.
              key={openThread.id}
              drawingId={drawingId}
              thread={openThread}
              detached={pinPosition(openThread, elementsById).detached}
              readOnly={readOnly}
              onClose={() => setOpenThreadId(null)}
            />
          </div>
        </div>
      )}

      {draft && draftPin && (
        <div
          className="absolute z-20 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border"
          style={cardStyle(draftPin)}
        >
          <CommentComposer
            placeholder="Add a comment"
            submitLabel="Comment"
            autoFocus
            pending={start.isPending}
            onCancel={() => setDraft(null)}
            onSubmit={(body) =>
              start.mutate(
                { drawingId, anchor: draft, body },
                {
                  onSuccess: (id) => {
                    setDraft(null)
                    setOpenThreadId(id)
                  },
                },
              )
            }
          />
        </div>
      )}

      {panelOpen && (
        <CommentsPanel
          threads={sortForList(
            threads.filter(
              (thread) => thread.resolvedAt === null || showResolved,
            ),
          )}
          detachedIds={
            new Set(
              threads
                .filter((thread) => pinPosition(thread, elementsById).detached)
                .map((thread) => thread.id),
            )
          }
          openThreadId={openThreadId}
          readOnly={readOnly}
          placing={placing}
          showResolved={showResolved}
          onShowResolvedChange={setShowResolved}
          onAdd={startPlacing}
          onSelect={focusThread}
          onClose={() => onPanelOpenChange(false)}
        />
      )}
    </>
  )
}

function ThreadPin({
  thread,
  detached,
  active,
  style,
  onClick,
}: {
  thread: CommentThread
  detached: boolean
  active: boolean
  style: { left: number; top: number }
  onClick: () => void
}) {
  const first = thread.comments[0]
  const resolved = thread.resolvedAt !== null
  const count = thread.comments.length
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Comment by ${first ? authorName(first) : "Former member"}, ${count} ${count === 1 ? "comment" : "comments"}${resolved ? ", resolved" : ""}${thread.unread ? ", unread" : ""}`}
      aria-expanded={active}
      className={cn(
        // The bottom-left corner points at the anchor.
        "pointer-events-auto absolute flex size-8 -translate-y-full cursor-pointer items-center justify-center rounded-full rounded-bl-none bg-popover p-0.5 shadow-md ring-1 ring-border transition-transform hover:scale-110",
        active && "ring-2 ring-iris",
        resolved && "opacity-60",
        detached &&
          "ring-dashed outline-dashed outline-1 outline-muted-foreground",
      )}
      style={style}
    >
      {resolved ? (
        <CheckIcon className="size-4 text-muted-foreground" />
      ) : (
        <PersonAvatar person={first?.author ?? null} />
      )}
      {thread.unread && (
        <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-iris ring-2 ring-popover" />
      )}
    </button>
  )
}

function CommentsPanel({
  threads,
  detachedIds,
  openThreadId,
  readOnly,
  placing,
  showResolved,
  onShowResolvedChange,
  onAdd,
  onSelect,
  onClose,
}: {
  threads: CommentThread[]
  detachedIds: Set<string>
  openThreadId: string | null
  readOnly: boolean
  placing: boolean
  showResolved: boolean
  onShowResolvedChange: (show: boolean) => void
  onAdd: () => void
  onSelect: (thread: CommentThread) => void
  onClose: () => void
}) {
  return (
    <aside
      aria-label="Comments"
      className="absolute top-16 right-3 bottom-16 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg bg-popover shadow-lg ring-1 ring-border"
    >
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <h2 className="flex-1 text-sm font-medium">Comments</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close comments"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {!readOnly && (
          <Button size="sm" disabled={placing} onClick={onAdd}>
            <MessageSquarePlusIcon />
            Add comment
          </Button>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => onShowResolvedChange(event.target.checked)}
            className="accent-iris"
          />
          Show resolved
        </label>
      </div>
      {threads.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {readOnly
            ? "No comments."
            : "No comments yet. Add one to point at a spot or a shape."}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {threads.map((thread) => {
            const first = thread.comments[0]
            const replies = thread.comments.length - 1
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread)}
                  className={cn(
                    "flex w-full cursor-pointer gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-accent",
                    thread.id === openThreadId && "bg-accent",
                    thread.resolvedAt && "opacity-60",
                  )}
                >
                  <PersonAvatar person={first?.author ?? null} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="truncate font-medium">
                        {first ? authorName(first) : "Former member"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatAgo(thread.lastActivityAt)}
                      </span>
                      {thread.unread && (
                        <span
                          role="img"
                          aria-label="Unread"
                          className="ml-auto size-2 shrink-0 rounded-full bg-iris"
                        />
                      )}
                    </span>
                    <span className="line-clamp-2 text-sm break-words">
                      {first?.body}
                    </span>
                    {(replies > 0 ||
                      thread.resolvedAt ||
                      detachedIds.has(thread.id)) && (
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {replies > 0 &&
                          `${replies} ${replies === 1 ? "reply" : "replies"}`}
                        {thread.resolvedAt && (
                          <span className="flex items-center gap-1">
                            <CheckIcon className="size-3" />
                            Resolved
                          </span>
                        )}
                        {detachedIds.has(thread.id) && (
                          <span className="flex items-center gap-1">
                            <UnlinkIcon className="size-3" />
                            Shape deleted
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
