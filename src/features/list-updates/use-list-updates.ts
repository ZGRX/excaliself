// Client half of the lists socket: refetches the drawing, folder, and trash
// lists, the team library, proposed drawing edits, or comments, when the
// server says they changed. Reconnects forever.

import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { createReconnectBackoff } from "@/lib/socket/backoff"
import { createHeartbeat } from "@/lib/socket/heartbeat"
import {
  COMMENTS_CHANGED,
  EDITS_CHANGED,
  LIBRARY_CHANGED,
  LISTS_CHANGED,
  listUpdatesUrl,
  PING,
  PONG,
  SIGNED_OUT_CLOSE_CODE,
} from "./protocol"

const LIST_KEYS = [
  drawingsQueryOptions().queryKey,
  foldersQueryOptions().queryKey,
  // Key literal, not trashQueryOptions(): importing the trash feature here
  // would drag its server module into the app shell.
  ["trash"],
]
// Same: matches libraryQueryOptions().
const LIBRARY_KEY = ["library"]
// Same: matches drawingEditQueryOptions().
const EDITS_KEY = ["drawing-edits"]
// Same: matches commentThreadsQueryOptions().
const COMMENTS_KEY = ["comments"]

function invalidateLists(queryClient: QueryClient) {
  for (const queryKey of LIST_KEYS)
    void queryClient.invalidateQueries({ queryKey })
}

export function useListUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Shared across dials so the wait grows over a whole outage.
    const backoff = createReconnectBackoff()
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    // Set while a refetch waits for this tab's own mutations to settle.
    let stopWaiting: (() => void) | null = null

    const refetchLists = () => {
      if (stopWaiting) return
      // A refetch under this tab's own optimistic edit would undo it for a moment.
      if (queryClient.isMutating() === 0) return invalidateLists(queryClient)
      stopWaiting = queryClient.getMutationCache().subscribe(() => {
        if (queryClient.isMutating() > 0) return
        stopWaiting?.()
        stopWaiting = null
        invalidateLists(queryClient)
      })
    }

    // Library saves aren't mutations; the library sync guards its own.
    const refetchLibrary = () =>
      void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY })
    const refetchEdits = () =>
      void queryClient.invalidateQueries({ queryKey: EDITS_KEY })
    const refetchComments = () =>
      void queryClient.invalidateQueries({ queryKey: COMMENTS_KEY })

    const connect = () => {
      const current = new WebSocket(listUpdatesUrl(window.location))
      socket = current
      const beat = createHeartbeat({
        ping: () => current.send(PING),
        // A silent OPEN socket died without a FIN; closing it triggers the retry.
        onSilent: () => current.close(),
      })

      current.addEventListener("open", () => {
        beat.start()
        backoff.reset()
        // Changes before this open (after the loader's fetch, or in an outage) sent it nothing.
        refetchLists()
        refetchLibrary()
        refetchEdits()
        refetchComments()
      })

      current.addEventListener("message", (event) => {
        if (event.data === PONG) beat.acknowledge()
        else if (event.data === LISTS_CHANGED) refetchLists()
        else if (event.data === LIBRARY_CHANGED) refetchLibrary()
        else if (event.data === EDITS_CHANGED) refetchEdits()
        else if (event.data === COMMENTS_CHANGED) refetchComments()
      })

      current.addEventListener("close", (event) => {
        beat.stop()
        // Closes are async: the effect may have torn down or dialed again.
        if (socket !== current) return
        socket = null
        if (event.code === SIGNED_OUT_CLOSE_CODE) return
        retryTimer = setTimeout(connect, backoff.next())
      })
    }

    connect()
    return () => {
      if (retryTimer !== null) clearTimeout(retryTimer)
      stopWaiting?.()
      const last = socket
      socket = null
      last?.close()
    }
  }, [queryClient])
}
