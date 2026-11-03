import type { LibraryItem } from "@excalidraw/excalidraw/types"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  customType,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").default(false),
  // "" when unset. better-auth's cookie cache rejects a null name.
  name: text("name").notNull(),
  image: text("image"),
  role: text("role", { enum: ["admin", "user"] })
    .notNull()
    .default("user"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  idToken: text("idToken"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

export const invites = pgTable("invites", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  invitedBy: text("invitedBy")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  usedBy: text("usedBy").references(() => users.id, { onDelete: "set null" }),
  usedAt: timestamp("usedAt"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

// Personal access tokens: what a member's AI client signs in to the MCP
// endpoint with. Only a hash is kept; the token itself is shown once.
export const accessTokens = pgTable("access_tokens", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  // The token's first characters, so a member can tell tokens apart.
  start: text("start").notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt")
    .notNull()
    .$defaultFn(() => new Date()),
})

// Admin-generated password-reset links (issue #68) — the product's only
// reset flow, shared out-of-band. Same single-use token model as invites,
// but targeted at a user and short-lived (24 h).
export const passwordResets = pgTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    usedAt: timestamp("usedAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // At most one unused reset per user, enforced by the database — the
    // upsert in createPasswordReset targets this index so concurrent
    // generations serialize instead of leaving two live links.
    onePendingPerUser: uniqueIndex("password_resets_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.usedAt} is null`),
  }),
)

// Where a drawing or folder lives: its creator's Private space or the shared
// Team space. Who may see a row is decided in features/spaces/access.ts.
export const spaces = ["private", "team"] as const
export type Space = (typeof spaces)[number]

export const folders = pgTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    space: text("space", { enum: spaces }).notNull().default("private"),
    // Null once the creator is deleted; only Team rows outlive them.
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    parentId: text("parentId"),
    // The Excalidraw+ collection this folder was imported from, so a second
    // import reuses it.
    excalidrawPlusId: text("excalidrawPlusId"),
    // Soft delete: set means "in trash". trashRootId records the trash unit —
    // the id of the folder/drawing whose trashing swept this row along — so a
    // whole subtree can be restored as one unit while each row's trashed
    // state stays individually knowable.
    deletedAt: timestamp("deletedAt"),
    trashRootId: text("trashRootId"),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    parentReference: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    creatorUnlessTeam: check(
      "folders_creator_unless_team",
      sql`${table.space} = 'team' OR ${table.createdBy} IS NOT NULL`,
    ),
  }),
)

export const drawings = pgTable(
  "drawings",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    data: text("data").notNull().default("{}"),
    // The scene's text, derived on every write so lists can search without
    // shipping scenes.
    searchText: text("searchText").notNull().default(""),
    folderId: text("folderId").references(() => folders.id, {
      onDelete: "cascade",
    }),
    // The Excalidraw+ scene this drawing was imported from, so a second
    // import skips it.
    excalidrawPlusId: text("excalidrawPlusId"),
    space: text("space", { enum: spaces }).notNull().default("private"),
    // See folders.createdBy.
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    // Soft delete — see folders.deletedAt/trashRootId for the model.
    deletedAt: timestamp("deletedAt"),
    trashRootId: text("trashRootId"),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    creatorUnlessTeam: check(
      "drawings_creator_unless_team",
      sql`${table.space} = 'team' OR ${table.createdBy} IS NOT NULL`,
    ),
  }),
)

// Per-member stars; a row means "starred by this member".
export const stars = pgTable(
  "stars",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.drawingId] }),
  }),
)

// A drawing is shared iff it has a row here; at most one link per drawing.
export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    audience: text("audience", { enum: ["members", "anyone"] })
      .notNull()
      .default("members"),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    oneLinkPerDrawing: uniqueIndex("shares_one_link_per_drawing").on(
      table.drawingId,
    ),
  }),
)

// A members link dropped by a move to Team. Not a share: it only sends
// signed-in members on to the drawing.
export const shareRedirects = pgTable("share_redirects", {
  token: text("token").primaryKey(),
  drawingId: text("drawingId")
    .notNull()
    .references(() => drawings.id, { onDelete: "cascade" }),
})

// node-postgres reads bytea as a Buffer, PGlite as a plain Uint8Array; wrap
// the latter (no copy) so callers always get a Buffer.
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) =>
    Buffer.from(value.buffer, value.byteOffset, value.byteLength),
})

export const drawingFiles = pgTable(
  "drawing_files",
  {
    id: text("id").primaryKey(),
    drawingId: text("drawingId")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    fileId: text("fileId").notNull(),
    mimeType: text("mimeType").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    oneRowPerFile: uniqueIndex("drawing_files_one_row_per_file").on(
      table.drawingId,
      table.fileId,
    ),
  }),
)

// The team library: the Library panel's items, one set for the instance.
// `item` is Excalidraw's LibraryItem as is; newest (highest seq) first.
export const libraryItems = pgTable("library_items", {
  id: text("id").primaryKey(),
  item: jsonb("item").$type<LibraryItem>().notNull(),
  seq: integer("seq").generatedAlwaysAsIdentity().notNull(),
})
