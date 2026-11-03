import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

import { env } from "@/env"
import { purgeExpiredTrash, startTrashPurgeJob } from "@/features/trash/purge"
import { processSingleton } from "@/lib/process-singleton"
import * as schema from "./schema.ts"

// node-postgres in production, PGlite in preview. Both run the same SQL, so
// callers only see the driver-agnostic base class.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

async function connectPostgres(): Promise<Db> {
  // env.ts already requires it outside preview.
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set")
  const db = drizzle(env.DATABASE_URL, { schema })
  // Shows a migration's RAISE WARNING (e.g. images 0009 deletes) in the app log.
  db.$client.on("connect", (client) =>
    client.on("notice", (notice) => {
      if (notice.severity === "WARNING") console.warn(notice.message)
    }),
  )

  try {
    await migrate(db, { migrationsFolder: "./drizzle" })
    console.log("Database migrations applied")
  } catch (err) {
    console.error("Database migration failed", err)
    process.exit(1)
  }
  return db
}

// PR code can read process.env, and Coolify copies production values into
// previews. Only a warning: the local SSO test runs preview mode with secrets.
function warnAboutPreviewSecrets() {
  const secrets = (
    [
      "GOOGLE_CLIENT_SECRET",
      "MICROSOFT_CLIENT_SECRET",
      "OIDC_CLIENT_SECRET",
    ] as const
  ).filter((name) => env[name])
  if (secrets.length === 0) return
  console.warn(
    `[preview] ${secrets.join(", ")} set. The code of a PR can read them. Clear them in the preview environment (docs/pr-previews.md).`,
  )
}

async function connect() {
  if (env.PREVIEW_MODE) warnAboutPreviewSecrets()
  // Preview never touches DATABASE_URL: Coolify may hand it the production
  // one, and a PR's migrations must not reach production. Imported on
  // demand, so production never loads PGlite.
  const db = env.PREVIEW_MODE
    ? await (await import("./preview.ts")).createPreviewDb()
    : await connectPostgres()

  // First background job: 30-day trash auto-purge. Runs once now (catching
  // anything that went purge-overdue while the server was down) and then
  // hourly, with no external cron.
  startTrashPurgeJob(() => purgeExpiredTrash(db))
  return db
}

// Both bundles include this module, and each loads on its first request. One
// promise per process means one pool (or one PGlite), one migration run, and
// one purge job; a bundle that loads mid-migration waits for it.
export const db = await processSingleton("db", connect)
