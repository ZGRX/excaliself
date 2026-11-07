// The drawings list behind every Gallery, the sidebar, and search (⌘K and the
// Browse toolbar filter it client-side). Kept out of server.ts so tests can
// drive it with a fake db.

import { and, desc, eq, isNull } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings, stars, users } from "@/db/schema"
import { userDisplayName, userInitials } from "@/features/account/display-name"
import { accessibleTo } from "@/features/spaces/access"
import { drawingListColumns, starOf } from "./list-columns"

/** Every untrashed drawing `userId` can see, in both spaces, newest edit first. */
export async function listDrawings(db: Db, userId: string) {
  const rows = await db
    .select({
      ...drawingListColumns,
      creatorUser: { name: users.name, email: users.email, image: users.image },
    })
    .from(drawings)
    .leftJoin(stars, starOf(userId))
    .leftJoin(users, eq(users.id, drawings.createdBy))
    .where(and(accessibleTo(drawings, userId), isNull(drawings.deletedAt)))
    .orderBy(desc(drawings.updatedAt))
  // Team cards show who made each drawing. Null once the creator is
  // deleted; emails stay on the server.
  return rows.map(({ creatorUser, ...drawing }) => ({
    ...drawing,
    creator: creatorUser && {
      name: userDisplayName(creatorUser),
      initials: userInitials(creatorUser),
      image: creatorUser.image,
    },
  }))
}
