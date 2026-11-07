// Drawing id → room: how members reach a Team Drawing's Room, with no link.

import { eq } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings } from "@/db/schema"
import { canAccess } from "@/features/spaces/access"
import { auth } from "@/lib/auth"
import { memberDisplayName } from "./identity"
import type { RoomJoin } from "./room-token"

/**
 * Admits a signed-in member to a live Team Drawing they can access. A Private
 * Drawing's Room is reached only through its Share link.
 */
export async function resolveRoomForDrawing(
  db: Db,
  drawingId: string,
  headers: Headers,
): Promise<RoomJoin> {
  // Session first, so a visitor with none costs the db nothing.
  const session = await auth.api.getSession({ headers })
  if (!session || !drawingId) return { status: "refused" }
  const { user } = session

  const [drawing] = await db
    .select({
      id: drawings.id,
      space: drawings.space,
      createdBy: drawings.createdBy,
      deletedAt: drawings.deletedAt,
    })
    .from(drawings)
    .where(eq(drawings.id, drawingId))
  if (
    !drawing ||
    !canAccess(drawing, user.id) ||
    drawing.space !== "team" ||
    drawing.deletedAt !== null
  )
    return { status: "refused" }

  return {
    status: "ok",
    // The same Room id as the token entry, so members and guests meet.
    roomId: drawing.id,
    identity: {
      userId: user.id,
      sessionId: session.session.id,
      displayName: memberDisplayName(user),
      image: user.image ?? null,
    },
  }
}
