import { Pencil } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { useRenameDrawing } from "@/features/drawings/mutations"
import { useRenameFolder } from "@/features/folders/mutations"
import { useDeferredFocusSelect } from "@/hooks/use-deferred-focus-select"

export type RenameTarget = {
  kind: "drawing" | "folder"
  id: string
  name: string
}

type RenameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: RenameTarget
}

/**
 * The standard rename dialog (spec §4.1): list surfaces like the palette are
 * never forms, so their Rename rows close into this. Saving is optimistic —
 * the dialog closes immediately; the mutation rolls the cache back and shows
 * an error toast on failure.
 */
export function RenameDialog({
  open,
  onOpenChange,
  target,
}: RenameDialogProps) {
  const renameDrawingMutation = useRenameDrawing()
  const renameFolderMutation = useRenameFolder()
  const [name, setName] = useState(target.name)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // The whole dialog exists to type a name into — focus it on open, with the
  // current name selected so typing replaces it. Deferred: an autoFocus'd
  // input's onFocus never fires, and a closing menu would steal focus back.
  useDeferredFocusSelect(inputRef, open)

  // The host keeps this component mounted across opens — refill from the
  // current name on every open so a previous edit can't leak into the next
  useEffect(() => {
    if (open) setName(target.name)
  }, [open, target.name])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed !== target.name) {
      if (target.kind === "drawing") {
        renameDrawingMutation.mutate({
          data: { id: target.id, updateData: { name: trimmed } },
        })
      } else {
        renameFolderMutation.mutate({ data: { id: target.id, name: trimmed } })
      }
    }
    onOpenChange(false)
  }

  const title = target.kind === "drawing" ? "Rename drawing" : "Rename folder"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[30%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-sm"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="m-2 flex items-center gap-2.5 rounded-md bg-well px-3 py-2.5 shadow-well">
          <Pencil className="h-4 w-4 shrink-0 text-iris" strokeWidth={2.5} />
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={
              target.kind === "drawing" ? "Drawing name…" : "Folder name…"
            }
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex items-center justify-between border-t border-hairline bg-muted/40 px-4 py-2">
          <span className="text-xs text-muted-foreground/60">{title}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
            <Kbd className="h-4 min-w-4 text-[10px]">↵</Kbd> to rename
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
