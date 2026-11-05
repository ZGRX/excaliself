// @vitest-environment node
import { PGlite } from "@electric-sql/pglite"
import { verifyPassword } from "better-auth/crypto"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { beforeAll, expect, test } from "vitest"
import { memberForToken } from "@/features/access-tokens/tokens"
import { bytesToDataUrl } from "@/features/drawings/file-bytes"
import { moveToTeam } from "@/features/spaces/move-to-team"
import { purgeExpiredTrash } from "@/features/trash/purge"
import { demoAccessToken, demoAdmin } from "./demo-content"
import type { Db } from "./index"
import { createPreviewDb } from "./preview"
import { insertPreviewUser } from "./preview-seed"
import * as schema from "./schema"
import { accounts, drawingFiles, users } from "./schema"

let db: Db
beforeAll(async () => {
  db = await createPreviewDb()
}, 30_000)

test("runs the migrations and seeds an admin who can sign in", async () => {
  const [admin] = await db
    .select({ role: users.role, hash: accounts.password })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(eq(users.email, demoAdmin.email))
  expect(admin.role).toBe("admin")
  expect(
    await verifyPassword({
      hash: admin.hash ?? "",
      password: demoAdmin.password,
    }),
  ).toBe(true)
})

// The token is seeded data, not code: a database preview mode did not seed,
// as every real instance's, refuses it even for the same admin.
test("the public MCP token works only in the preview database", async () => {
  expect(await memberForToken(db, demoAccessToken)).toMatchObject({
    id: demoAdmin.id,
  })

  const unseeded = drizzle({ client: new PGlite(), schema })
  await migrate(unseeded, { migrationsFolder: "./drizzle" })
  await insertPreviewUser(unseeded, { ...demoAdmin, role: "admin" })
  expect(await memberForToken(unseeded, demoAccessToken)).toBeNull()
}, 30_000)

test("reads bytea back as a Buffer", async () => {
  await db.insert(drawingFiles).values({
    id: "file-1",
    drawingId: "demo-welcome",
    fileId: "image-1",
    mimeType: "image/png",
    bytes: Buffer.from([1, 2, 3]),
  })
  const [file] = await db.select().from(drawingFiles)
  expect(bytesToDataUrl(file.mimeType, file.bytes)).toBe(
    "data:image/png;base64,AQID",
  )
})

// PGlite has one connection; a transaction that waited on another would hang.
test("runs concurrent locking transactions on its one connection", async () => {
  const moved = await Promise.all([
    moveToTeam(db, demoAdmin.id, { type: "folder", id: "demo-notes" }, null),
    purgeExpiredTrash(db),
  ])
  expect(moved[0]).toEqual(["demo-weekly-planning"])
})
