"use server"

import { randomBytes, randomUUID } from "node:crypto"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { and, eq, gt, isNull } from "drizzle-orm"
import z from "zod"
import { db } from "@/db"
import { invites, users } from "@/db/schema"
import { userDisplayName } from "@/features/account/display-name"
import { registerFieldsSchema } from "@/features/auth/schema"
import { auth } from "@/lib/auth"
import { adminMiddleware } from "@/middleware/admin"

const usableInvite = (token: string) =>
  and(
    eq(invites.token, token),
    isNull(invites.usedAt),
    gt(invites.expiresAt, new Date()),
  )

/**
 * Public (pre-auth) check of an invite token. Returns only what the invite
 * page needs — the inviter's name for the personalized headline — never the
 * invite row itself.
 */
export const validateInvite = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data: token }) => {
    const [invite] = await db
      .select({ inviterName: users.name, inviterEmail: users.email })
      .from(invites)
      .leftJoin(users, eq(invites.invitedBy, users.id))
      .where(usableInvite(token))
    if (!invite) return null
    // Same fallback rule as everywhere: display name, else email prefix.
    // Null only when the inviter no longer exists.
    return {
      inviterName: invite.inviterEmail
        ? userDisplayName({
            name: invite.inviterName,
            email: invite.inviterEmail,
          })
        : null,
    }
  })

export const registerWithInvite = createServerFn({ method: "POST" })
  .validator(registerFieldsSchema.extend({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    // Claim the invite before the account exists, so of parallel requests
    // with one token only the winner creates an account.
    const [invite] = await db
      .update(invites)
      .set({ usedAt: new Date() })
      .where(usableInvite(data.token))
      .returning({ id: invites.id })
    if (!invite) {
      throw new Error("Invalid or expired invite link")
    }

    // signUpEmail also signs the new member in: better-auth creates a session
    // (autoSignIn default) and the tanstackStartCookies plugin copies its
    // set-cookie onto this server function's response, so the browser is
    // authenticated when this call returns.
    const result = await auth.api
      .signUpEmail({
        // Preview derives its base URL from the request.
        headers: getRequestHeaders(),
        body: {
          email: data.email,
          password: data.password,
          // Display names are only ever set in Settings; "" means unset and
          // the email-prefix fallback covers it (spec §5.12).
          name: "",
        },
      })
      .catch(async (error: unknown) => {
        // No account was made (e.g. the email is taken): free the invite.
        await db
          .update(invites)
          .set({ usedAt: null })
          .where(eq(invites.id, invite.id))
        throw error
      })

    if (!result.user || !result.token) {
      throw new Error("Failed to create account")
    }
    await db
      .update(invites)
      .set({ usedBy: result.user.id })
      .where(eq(invites.id, invite.id))
  })

export const createInvite = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .handler(async ({ context }) => {
    const id = randomUUID()
    const token = randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    await db.insert(invites).values({
      id,
      token,
      invitedBy: context.session.user.id,
      expiresAt,
      createdAt: new Date(),
    })

    return { id, token }
  })

export const getPendingInvites = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () =>
    db
      .select()
      .from(invites)
      .where(and(isNull(invites.usedAt), gt(invites.expiresAt, new Date()))),
  )

export const deleteInvite = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.string())
  .handler(async ({ data: id }) => {
    await db.delete(invites).where(eq(invites.id, id))
  })
