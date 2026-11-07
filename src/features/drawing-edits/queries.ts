import { queryOptions } from "@tanstack/react-query"
import { getDrawingEdit } from "./server"

export type PendingDrawingEdit = NonNullable<
  Awaited<ReturnType<typeof getDrawingEdit>>
>

export const drawingEditQueryOptions = (drawingId: string) =>
  queryOptions({
    queryKey: ["drawing-edits", drawingId] as const,
    queryFn: async (): Promise<PendingDrawingEdit | null> =>
      (await getDrawingEdit({ data: drawingId })) ?? null,
  })
