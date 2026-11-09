// The lists socket's wire: plain strings, since nothing rides along. The
// server says what changed and the tab refetches it.

export const LISTS_CHANGED = "changed"
export const LIBRARY_CHANGED = "library"
/** A member's proposed drawing edits changed. */
export const EDITS_CHANGED = "edits"
/** A drawing's comment threads changed. Open drawings refetch theirs. */
export const COMMENTS_CHANGED = "comments"
export type ListUpdate =
  | typeof LISTS_CHANGED
  | typeof LIBRARY_CHANGED
  | typeof EDITS_CHANGED
  | typeof COMMENTS_CHANGED
export const PING = "ping"
export const PONG = "pong"

/** Sent to a socket with no session. Final: the tab stops dialing. */
export const SIGNED_OUT_CLOSE_CODE = 4401

/** Matches `server/routes/ws/lists.ts`. */
export function listUpdatesUrl(location: {
  protocol: string
  host: string
}): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:"
  return `${scheme}//${location.host}/ws/lists`
}
