import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { polled } from "@/lib/polling"
import type { LiveDrawing } from "./live"
import type { Participant } from "./protocol"
import { getLiveDrawings } from "./server"

/** One shared key, so one poll loop. The badge is ambient, so polling is fine. */
export const liveDrawingsQueryOptions = () =>
  queryOptions({
    queryKey: ["drawings", "live"] as const,
    queryFn: () => getLiveDrawings(),
    ...polled,
  })

/** Who else is in this drawing. Selects per row, so only that card re-renders. */
export function useLiveDrawing(drawingId: string): LiveDrawing | null {
  const { data } = useQuery({
    ...liveDrawingsQueryOptions(),
    select: (live) =>
      live.drawings.find((entry) => entry.drawingId === drawingId) ?? null,
  })
  return data ?? null
}

/**
 * Refetches the badges when the open Room's roster changes, so a join or
 * leave shows in the sidebar now, not on the next poll.
 */
export function useRefreshLiveOnRoster(others: readonly Participant[]) {
  const queryClient = useQueryClient()
  const roster = others.map((p) => `${p.connectionId}:${p.name}`).join()
  const previous = useRef(roster)
  useEffect(() => {
    if (roster === previous.current) return
    previous.current = roster
    void queryClient.invalidateQueries({
      queryKey: liveDrawingsQueryOptions().queryKey,
    })
  }, [roster, queryClient])
}
