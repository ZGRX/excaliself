import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { commentThreadsQueryOptions } from "./queries"
import {
  deleteOwnComment,
  editOwnComment,
  markCommentThreadRead,
  replyToCommentThread,
  resolveCommentThread,
  startCommentThread,
} from "./server"

/** Every comment write refetches the drawing's threads once it settles. */
function useCommentMutation<Variables, Result>(
  drawingId: string,
  mutationFn: (variables: Variables) => Promise<Result>,
  quiet = false,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onError: quiet
      ? undefined
      : (error) =>
          toast.error("Your comment wasn't saved", {
            description: error.message,
          }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: commentThreadsQueryOptions(drawingId).queryKey,
      }),
  })
}

export const useStartThread = (drawingId: string) =>
  useCommentMutation(
    drawingId,
    (data: Parameters<typeof startCommentThread>[0]["data"]) =>
      startCommentThread({ data }),
  )

export const useReply = (drawingId: string) =>
  useCommentMutation(drawingId, (data: { threadId: string; body: string }) =>
    replyToCommentThread({ data }),
  )

export const useResolve = (drawingId: string) =>
  useCommentMutation(
    drawingId,
    (data: { threadId: string; resolved: boolean }) =>
      resolveCommentThread({ data }),
  )

export const useEditComment = (drawingId: string) =>
  useCommentMutation(drawingId, (data: { commentId: string; body: string }) =>
    editOwnComment({ data }),
  )

export const useDeleteComment = (drawingId: string) =>
  useCommentMutation(drawingId, (commentId: string) =>
    deleteOwnComment({ data: commentId }),
  )

/** Quiet: a failed read mark only leaves a dot. */
export const useMarkRead = (drawingId: string) =>
  useCommentMutation(
    drawingId,
    (threadId: string) => markCommentThreadRead({ data: threadId }),
    true,
  )
