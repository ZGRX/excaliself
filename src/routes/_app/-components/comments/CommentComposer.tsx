// The text box for a new thread, a reply, or an edit. Enter sends,
// Shift+Enter adds a line.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { MAX_COMMENT_LENGTH } from "@/features/comments/limits"
import { cn } from "@/lib/utils"

const SHOW_COUNT_FROM = MAX_COMMENT_LENGTH - 200

export function CommentComposer({
  initialBody = "",
  placeholder,
  submitLabel,
  pending,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  initialBody?: string
  placeholder?: string
  submitLabel: string
  pending: boolean
  autoFocus?: boolean
  onSubmit: (body: string) => void
  onCancel?: () => void
}) {
  const [body, setBody] = useState(initialBody)
  const length = [...body.trim()].length
  const tooLong = length > MAX_COMMENT_LENGTH
  const canSubmit = length > 0 && !tooLong && !pending
  const submit = () => {
    if (canSubmit) onSubmit(body)
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        value={body}
        placeholder={placeholder}
        aria-label={placeholder ?? submitLabel}
        autoFocus={autoFocus}
        rows={2}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            submit()
          } else if (event.key === "Escape" && onCancel) {
            // Tells the layer's Escape handler this one was taken.
            event.preventDefault()
            onCancel()
          }
        }}
        className="max-h-40 min-h-14 w-full resize-none rounded-md border border-transparent bg-well px-2.5 py-1.5 text-sm shadow-well outline-none placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/30 [field-sizing:content]"
      />
      <div className="flex items-center gap-2">
        {length >= SHOW_COUNT_FROM && (
          <span
            className={cn(
              "text-xs tabular-nums text-muted-foreground",
              tooLong && "text-destructive",
            )}
          >
            {length}/{MAX_COMMENT_LENGTH}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}
