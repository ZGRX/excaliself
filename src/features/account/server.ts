"use server"

import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { APIError } from "better-auth/api"
import { and, eq, ne } from "drizzle-orm"
import z from "zod"
import { db } from "@/db"
import { accounts, sessions, users } from "@/db/schema"
import {
  countOwnedContent,
  hardDeleteUser,
  sharedDrawingIds,
} from "@/features/admin/delete-user"
import { isLastAdmin } from "@/features/admin/roles"
import { endRooms, rooms } from "@/features/collab/room-registry"
import { evictUser } from "@/features/collab/room-session"
import { isTeamEnabled } from "@/features/spaces/team-enabled"
import { auth } from "@/lib/auth"
import { authMiddleware } from "@/middleware/auth"
import { compareSessions } from "./sessions"

// The caller's users row, plus teamEnabled, the instance-wide gate on every
// Team UI element. hasPassword is false for members who only use SSO.
export const getCurrentUser = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const userId = context.session.user.id
    const [[user], [password], teamEnabled] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId)),
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.providerId, "credential"),
          ),
        ),
      isTeamEnabled(db),
    ])
    if (!user) throw new Error("User not found")
    return { ...user, hasPassword: password !== undefined, teamEnabled }
  })

export type ChangeEmailResult =
  | { ok: true }
  | { ok: false; error: "invalid-password" | "email-taken" }

/**
 * Change the sign-in email after re-authenticating with the current
 * password. The instance has no SMTP, so there is no verification loop —
 * the email is a login identifier and the change takes effect immediately.
 * Expected failures come back as a typed result so the form can pin them
 * to the right field; anything else stays an exception.
 */
export const changeEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      newEmail: z.email().trim().toLowerCase().max(255),
      currentPassword: z.string().min(1),
    }),
  )
  .handler(async ({ data, context }): Promise<ChangeEmailResult> => {
    try {
      // Compares against the stored credential hash; throws BAD_REQUEST on a
      // mismatch.
      await auth.api.verifyPassword({
        body: { password: data.currentPassword },
        headers: getRequestHeaders(),
      })
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 400) {
        return { ok: false, error: "invalid-password" }
      }
      throw error
    }

    const userId = context.session.user.id
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, data.newEmail), ne(users.id, userId)))
    if (taken) return { ok: false, error: "email-taken" }

    try {
      await db
        .update(users)
        .set({ email: data.newEmail, updatedAt: new Date() })
        .where(eq(users.id, userId))
    } catch (error) {
      // The pre-check races a concurrent claim of the same email; the unique
      // constraint is the arbiter, so map its violation to the same result.
      if (isUniqueViolation(error)) return { ok: false, error: "email-taken" }
      throw error
    }
    return { ok: true }
  })

// Postgres unique_violation; node-postgres surfaces the code on the error
// itself, drizzle sometimes on its cause.
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "23505") ||
      (error.cause instanceof Error &&
        "code" in error.cause &&
        error.cause.code === "23505"))
  )
}

// Display name is optional (spec §5.12): an empty submission clears it to ""
// so the email-prefix fallback takes over everywhere.
export const updateProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().max(120) }))
  .handler(async ({ data, context }) => {
    await db
      .update(users)
      .set({ name: data.name, updatedAt: new Date() })
      .where(eq(users.id, context.session.user.id))
  })

// Session tokens are credentials — rows go to the client keyed by id only,
// and the id→token mapping needed for revocation stays server-side.
export const listActiveSessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const active = await auth.api.listSessions({
      headers: getRequestHeaders(),
    })
    const currentId = context.session.session.id
    return active
      .map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        lastActiveAt: session.updatedAt,
        current: session.id === currentId,
      }))
      .sort(compareSessions)
  })

// The current session is only ever ended through sign-out, so the row action
// can't strand the user; revoking it here is rejected outright.
export const revokeSessionById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    if (data.id === context.session.session.id) {
      throw new Error("The current session cannot be revoked")
    }
    const [target] = await db
      .select({ token: sessions.token, userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.id, data.id))
    if (!target || target.userId !== context.session.user.id) {
      throw new Error("Session not found")
    }
    await auth.api.revokeSession({
      body: { token: target.token },
      headers: getRequestHeaders(),
    })
  })

export const revokeOtherSessions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    await auth.api.revokeOtherSessions({ headers: getRequestHeaders() })
  })

// Whether the danger zone must block self-deletion (issue #67): the sole
// admin can't delete their account, or the instance would be locked out of
// every admin page.
export const getDeleteAccountState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
    return {
      soleAdmin: isLastAdmin(
        admins.map((admin) => admin.id),
        context.session.user.id,
      ),
    }
  })

// Feeds the danger zone's tier-3 confirm copy — the caller-scoped twin of
// the admin getUserContentCounts.
export const getMyContentCounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    countOwnedContent(db, context.session.user.id),
  )

// Self-delete behind the Account danger zone (issue #67). hardDeleteUser
// enforces the last-admin guard server-side regardless of what the UI shows.
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const userId = context.session.user.id
    const shared = await sharedDrawingIds(db, userId)
    await hardDeleteUser(db, userId)
    // Hang up on their shared drawings' Rooms (the flush finds no row and
    // writes nothing), and on their seats in every other Room.
    await Promise.all([endRooms(shared), evictUser(rooms, userId)])
    // The session rows died with the user; sign out to clear the browser's
    // session cookie. Best-effort: the client hard-redirects to /login anyway.
    try {
      await auth.api.signOut({ headers: getRequestHeaders() })
    } catch {}
  })
