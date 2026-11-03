// The lists socket, behind `server/routes/ws/lists.ts`. Members only.

import { defineWebSocketHandler } from "nitro"
import { auth } from "@/lib/auth"
import { fromOwnOrigin } from "@/lib/same-origin"
import {
  SERVER_RESTART_CLOSE_CODE,
  SERVER_RESTART_CLOSE_REASON,
} from "@/lib/socket/shutdown"
import { listUpdates } from "./hub"
import { PING, PONG, SIGNED_OUT_CLOSE_CODE } from "./protocol"

type ListsContext = { signedIn?: true; unsubscribe?: () => void }

export const listsSocket = defineWebSocketHandler({
  async upgrade(request) {
    if (!fromOwnOrigin(request)) return
    const session = await auth.api.getSession({ headers: request.headers })
    // Accept and close in `open`: a refused handshake is an opaque 1006 the
    // client can't tell from an outage, so it would retry forever.
    if (!session) return
    return { context: { signedIn: true } }
  },

  open(peer) {
    const context = peer.context as ListsContext
    if (!context.signedIn)
      return peer.close(SIGNED_OUT_CLOSE_CODE, "Signed out")
    context.unsubscribe = listUpdates.add({
      notify: (update) => peer.send(update),
      close: () =>
        peer.close(SERVER_RESTART_CLOSE_CODE, SERVER_RESTART_CLOSE_REASON),
    })
  },

  message(peer, message) {
    if (message.text() === PING) peer.send(PONG)
  },

  close(peer) {
    ;(peer.context as ListsContext).unsubscribe?.()
  },
})
