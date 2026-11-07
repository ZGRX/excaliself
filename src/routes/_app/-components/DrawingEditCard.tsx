// The card where a member applies or discards a change their AI client
// proposed. Applying edits this tab's canvas like a person would, so the
// Room or autosave writes it, and Ctrl+Z undoes it.

import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToSvg,
  getCommonBounds,
  restoreElements,
} from "@excalidraw/excalidraw"
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types"
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Maximize2Icon, SparklesIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  isStale,
  type Revision,
  withEdit,
} from "@/features/drawing-edits/apply"
import { drawingEditQueryOptions } from "@/features/drawing-edits/queries"
import { decideDrawingEdit } from "@/features/drawing-edits/server"
import type { Decision } from "@/features/drawing-edits/store"

const HIGHLIGHT = { added: "#2f9e44", changed: "#1971c2", removed: "#e03131" }

type Props = {
  drawingId: string
  excalidrawAPI: ExcalidrawImperativeAPI | null
  theme: "light" | "dark"
}

export function DrawingEditCard({ drawingId, excalidrawAPI, theme }: Props) {
  const queryClient = useQueryClient()
  const { data: edit } = useQuery(drawingEditQueryOptions(drawingId))
  const [enlarged, setEnlarged] = useState(false)
  const elements = useMemo(
    () =>
      edit
        ? restoreElements(
            JSON.parse(edit.elements) as ExcalidrawElement[],
            null,
          )
        : [],
    [edit],
  )
  // A snapshot of the drawing as it would be, taken when the proposal arrives.
  const preview = useMemo(
    () =>
      edit && excalidrawAPI
        ? previewScene(excalidrawAPI.getSceneElements(), elements, edit.base)
        : [],
    [edit, elements, excalidrawAPI],
  )

  const decide = useMutation({
    // The id rides along: the claim refetches the query to null mid-apply.
    mutationFn: (data: { id: string; decision: Decision }) =>
      decideDrawingEdit({ data }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: drawingEditQueryOptions(drawingId).queryKey,
      }),
  })

  if (!edit || !excalidrawAPI) return null

  const apply = async () => {
    setEnlarged(false)
    // Claimed first: a proposal another tab decided, or one replaced or
    // expired, never reaches the canvas.
    if (!(await decide.mutateAsync({ id: edit.id, decision: "applying" }))) {
      toast.error("This proposal is no longer open", {
        description: "Nothing was changed.",
      })
      return
    }
    // Checked and applied with no await between, so no remote edit slips in.
    const current = excalidrawAPI.getSceneElementsIncludingDeleted()
    const stale = isStale(current, edit.base)
    if (!stale)
      excalidrawAPI.updateScene({
        elements: withEdit(current, elements as OrderedExcalidrawElement[]),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
    await decide.mutateAsync({
      id: edit.id,
      decision: stale ? "stale" : "applied",
    })
    if (stale)
      toast.error("The drawing changed before you applied this", {
        description: "Nothing was changed. Ask your AI client to try again.",
      })
  }
  const discard = () => {
    setEnlarged(false)
    decide.mutate({ id: edit.id, decision: "discarded" })
  }

  const actions = (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={decide.isPending}
        onClick={discard}
      >
        Discard
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={decide.isPending}
        onClick={() => void apply()}
      >
        {decide.isPending && decide.variables?.decision !== "discarded"
          ? "Applying…"
          : "Apply"}
      </Button>
    </>
  )
  const title = `${edit.client} proposes a change`

  return (
    <div className="pointer-events-none absolute inset-x-4 top-16 z-10 flex justify-end">
      <Card
        role="dialog"
        aria-label="Proposed change"
        // Opaque: the card's gradient fades to half-transparent over the canvas.
        className="pointer-events-auto flex w-[22rem] max-w-full flex-col gap-3 bg-popover p-4"
      >
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            {title}
          </p>
          <p className="text-sm font-medium">{edit.summary}</p>
        </div>
        <button
          type="button"
          onClick={() => setEnlarged(true)}
          aria-label="View the change larger"
          className="group flex cursor-zoom-in flex-col gap-1 rounded-md border border-border bg-background p-2"
        >
          <PreviewImage
            elements={preview}
            files={excalidrawAPI.getFiles()}
            theme={theme}
          />
          <span className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
            <Maximize2Icon className="size-3" />
            View larger
          </span>
        </button>
        <p className="text-xs text-muted-foreground">
          Nothing changes until you apply it, and you can undo it.
        </p>
        <div className="flex justify-end gap-2">{actions}</div>
      </Card>

      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent className="flex h-[85vh] w-[min(1200px,calc(100%-2rem))] max-w-none flex-col sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <SparklesIcon className="size-4" />
              {title}
            </DialogTitle>
            <DialogDescription>{edit.summary}</DialogDescription>
          </DialogHeader>
          <div className="drawing-edit-preview min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <Excalidraw
              initialData={{
                elements: preview,
                files: excalidrawAPI.getFiles(),
              }}
              // Look, zoom, and pan; nothing here can be edited or saved.
              viewModeEnabled
              theme={theme}
              excalidrawAPI={(api) =>
                requestAnimationFrame(() =>
                  api.scrollToContent(undefined, {
                    fitToViewport: true,
                    viewportZoomFactor: 0.9,
                  }),
                )
              }
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: false,
                  clearCanvas: false,
                  export: false,
                  loadScene: false,
                  saveAsImage: false,
                  saveToActiveFile: false,
                  toggleTheme: false,
                },
              }}
            />
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <Legend />
            <div className="flex justify-end gap-2">{actions}</div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Legend() {
  const items = [
    ["New", HIGHLIGHT.added],
    ["Changed", HIGHLIGHT.changed],
    ["Removed", HIGHLIGHT.removed],
  ] as const
  return (
    <ul className="flex gap-4 text-xs text-muted-foreground">
      {items.map(([label, color]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm border-2 border-dashed"
            style={{ borderColor: color }}
          />
          {label}
        </li>
      ))}
    </ul>
  )
}

/** The preview as a small picture, as tall as it needs up to a cap. */
function PreviewImage({
  elements,
  files,
  theme,
}: {
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  theme: "light" | "dark"
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void exportToSvg({
      elements,
      appState: {
        exportBackground: false,
        exportWithDarkMode: theme === "dark",
      },
      files,
      exportPadding: 12,
    }).then((svg: SVGSVGElement) => {
      if (cancelled || !ref.current) return
      svg.removeAttribute("width")
      svg.removeAttribute("height")
      svg.classList.add("h-auto", "max-h-40", "w-full")
      ref.current.replaceChildren(svg)
    })
    return () => {
      cancelled = true
    }
  }, [elements, files, theme])

  return <div ref={ref} aria-hidden className="flex min-h-16 items-center" />
}

/**
 * The drawing after the change, with new, changed, and removed elements
 * boxed, and removed ones faded in place. For looking only: it never goes
 * on the member's canvas.
 */
function previewScene(
  current: readonly ExcalidrawElement[],
  elements: readonly ExcalidrawElement[],
  base: Record<string, Revision>,
): ExcalidrawElement[] {
  const after = withEdit(current, elements).filter((el) => !el.isDeleted)
  const changed = new Set(elements.map(({ id }) => id))
  // A label is boxed with its container, when that changed too.
  const boxed = (element: ExcalidrawElement) =>
    !(
      element.type === "text" &&
      element.containerId &&
      changed.has(element.containerId)
    )
  const box = (element: ExcalidrawElement, color: string) => {
    const [x1, y1, x2, y2] = getCommonBounds([element])
    return {
      type: "rectangle" as const,
      x: x1 - 8,
      y: y1 - 8,
      width: x2 - x1 + 16,
      height: y2 - y1 + 16,
      strokeColor: color,
      backgroundColor: "transparent",
      strokeStyle: "dashed" as const,
      strokeWidth: 2,
      roughness: 0,
    }
  }
  const removed = new Set(
    elements.filter((el) => el.isDeleted).map(({ id }) => id),
  )
  const ghosts = current
    .filter((el) => removed.has(el.id))
    .map((el) => ({ ...el, opacity: 30 }))
  const highlights = convertToExcalidrawElements([
    ...elements
      .filter((el) => !el.isDeleted && boxed(el))
      .map((el) =>
        box(el, el.id in base ? HIGHLIGHT.changed : HIGHLIGHT.added),
      ),
    ...ghosts.filter(boxed).map((el) => box(el, HIGHLIGHT.removed)),
  ])
  return [...after, ...ghosts, ...highlights]
}
