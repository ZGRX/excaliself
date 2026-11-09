// One thread opened from its pin or the panel: the comments, a reply box,
// resolve and reopen, and edit or delete on the member's own comments.

import {
  CheckIcon,
  EllipsisIcon,
  RotateCcwIcon,
  UnlinkIcon,
  UserRound,
  XIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { DangerConfirmDialog } from "@/components/danger-confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user-avatar"
import {
  useDeleteComment,
  useEditComment,
  useReply,
  useResolve,
} from "@/features/comments/mutations"
import type { CommentThread } from "@/features/comments/queries"
import { formatAgo } from "@/lib/relative-time"
import { CommentComposer } from "./CommentComposer"

type Comment = CommentThread["comments"][number]
type Person = NonNullable<Comment["author"]>

const FORMER_MEMBER = "Former member"

export function PersonAvatar({ person }: { person: Person | null }) {
  if (person)
    return (
      <UserAvatar
        initials={person.initials}
        image={person.image}
        className="size-6"
      />
    )
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/70"
    >
      <UserRound className="size-3.5" />
    </span>
  )
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g

/** Plain text, with web addresses as links. */
export function CommentText({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {body.split(URL_PATTERN).map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-iris-strong underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

export const authorName = (comment: Comment) =>
  (comment.author?.name ?? FORMER_MEMBER) +
  (comment.via ? ` via ${comment.via}` : "")

function CommentRow({
  drawingId,
  comment,
  readOnly,
}: {
  drawingId: string
  comment: Comment
  readOnly: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const edit = useEditComment(drawingId)
  const remove = useDeleteComment(drawingId)
  const canChange = comment.mine && !readOnly

  return (
    <li className="flex gap-2">
      <PersonAvatar person={comment.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">
            {authorName(comment)}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatAgo(comment.createdAt)}
            {comment.editedAt && " · edited"}
          </span>
          {canChange && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Comment actions"
                    className="ml-auto size-6"
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <CommentComposer
            initialBody={comment.body}
            submitLabel="Save"
            pending={edit.isPending}
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={(body) =>
              edit.mutate(
                { commentId: comment.id, body },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        ) : (
          <CommentText body={comment.body} />
        )}
      </div>
      <DangerConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete comment"
        description="This comment is deleted for everyone. You can't undo this."
        confirmLabel="Delete comment"
        pendingLabel="Deleting…"
        onConfirm={() => remove.mutateAsync(comment.id)}
      />
    </li>
  )
}

export function CommentThreadCard({
  drawingId,
  thread,
  detached,
  readOnly,
  onClose,
}: {
  drawingId: string
  thread: CommentThread
  detached: boolean
  readOnly: boolean
  onClose: () => void
}) {
  const reply = useReply(drawingId)
  const resolve = useResolve(drawingId)
  const resolved = thread.resolvedAt !== null
  // Remounts the composer to clear it after a reply is saved.
  const [replies, setReplies] = useState(0)

  let status: ReactNode = null
  if (resolved)
    status = (
      <>
        <CheckIcon className="size-3.5" />
        Resolved by {thread.resolvedBy?.name ?? FORMER_MEMBER}
        {thread.resolvedAt && `, ${formatAgo(thread.resolvedAt)}`}
      </>
    )
  else if (detached)
    status = (
      <>
        <UnlinkIcon className="size-3.5" />
        Shape deleted
      </>
    )

  return (
    <div className="flex max-h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          {status ?? "Comment"}
        </p>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={resolved ? "Reopen thread" : "Resolve thread"}
            title={resolved ? "Reopen" : "Resolve"}
            disabled={resolve.isPending}
            onClick={() =>
              resolve.mutate(
                { threadId: thread.id, resolved: !resolved },
                { onSuccess: () => !resolved && onClose() },
              )
            }
          >
            {resolved ? <RotateCcwIcon /> : <CheckIcon />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close thread"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <ul className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            drawingId={drawingId}
            comment={comment}
            readOnly={readOnly}
          />
        ))}
      </ul>
      {!readOnly && (
        <div className="border-t border-border px-3 py-2">
          {resolved ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Reopen to reply
              </span>
              <Button
                size="sm"
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate({ threadId: thread.id, resolved: false })
                }
              >
                Reopen
              </Button>
            </div>
          ) : (
            <CommentComposer
              key={replies}
              placeholder="Reply"
              submitLabel="Reply"
              pending={reply.isPending}
              onSubmit={(body) =>
                reply.mutate(
                  { threadId: thread.id, body },
                  { onSuccess: () => setReplies((n) => n + 1) },
                )
              }
            />
          )}
        </div>
      )}
    </div>
  )
}
