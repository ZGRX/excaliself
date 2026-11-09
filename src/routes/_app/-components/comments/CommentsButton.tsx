// Opens the comments panel. The badge counts unread open threads, else open
// ones.

import { useQuery } from "@tanstack/react-query"
import { MessageSquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { commentThreadsQueryOptions } from "@/features/comments/queries"
import { cn } from "@/lib/utils"

export function useCommentCounts(drawingId: string) {
  const { data: threads = [] } = useQuery(commentThreadsQueryOptions(drawingId))
  const open = threads.filter((thread) => thread.resolvedAt === null)
  return {
    open: open.length,
    // Resolved threads are done and hidden, so they don't ask to be read.
    unread: open.filter((thread) => thread.unread).length,
  }
}

export function CommentsButton({
  drawingId,
  active,
  onClick,
  className,
}: {
  drawingId: string
  active: boolean
  onClick: () => void
  className?: string
}) {
  const { open, unread } = useCommentCounts(drawingId)
  const count = unread || open
  const label =
    unread > 0
      ? `Comments, ${unread} unread`
      : open > 0
        ? `Comments, ${open} open`
        : "Comments"
  return (
    <Button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title="Comments"
      className={cn("relative gap-1.5 px-2.5", className)}
    >
      <MessageSquareIcon className="h-3.5 w-3.5" />
      {count > 0 && (
        <span
          className={cn(
            "min-w-4 rounded-full px-1 text-[11px] leading-4 tabular-nums",
            unread > 0
              ? "bg-iris text-white"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </Button>
  )
}
