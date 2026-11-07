// Token → room, with the same access checks as the share page.

import type { Db } from "@/db"
import { resolveShareAccess } from "@/features/shares/access"
import { resolveShareForRoom } from "@/features/shares/store"
import { auth } from "@/lib/auth"
import { memberDisplayName } from "./identity"
import type { ParticipantIdentity } from "./room-session"

export type RoomJoin =
  | { status: "ok"; roomId: string; identity: ParticipantIdentity }
  /** Every refusal reason, so nothing tells whether the drawing exists. */
  | { status: "refused" }

export async function resolveRoomForToken(
  db: Db,
  token: string,
  headers: Headers,
): Promise<RoomJoin> {
  const [share, session] = await Promise.all([
    token ? resolveShareForRoom(db, token) : null,
    auth.api.getSession({ headers }),
  ])
  const user = session?.user ?? null
  const access = resolveShareAccess({ share, hasSession: user !== null })
  if (access !== "ok" || !share) return { status: "refused" }

  return {
    status: "ok",
    // One Room per drawing, so a regenerated link meets the same room.
    roomId: share.drawing.id,
    identity: {
      userId: user?.id ?? null,
      sessionId: session?.session.id ?? null,
      displayName: user ? memberDisplayName(user) : null,
      image: user?.image ?? null,
    },
  }
}
