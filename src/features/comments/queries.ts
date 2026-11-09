import { queryOptions } from "@tanstack/react-query"
import { getCommentThreads } from "./server"

export type CommentThread = Awaited<
  ReturnType<typeof getCommentThreads>
>[number]

/** A drawing's threads. The lists socket's `comments` frame refetches it. */
export const commentThreadsQueryOptions = (drawingId: string) =>
  queryOptions({
    queryKey: ["comments", drawingId] as const,
    queryFn: () => getCommentThreads({ data: drawingId }),
  })
