import { and, eq, getTableColumns, sql } from "drizzle-orm"
import { drawings, folders, stars } from "@/db/schema"

/** Longest drawing or folder name a write accepts. */
export const MAX_NAME_LENGTH = 1000

/**
 * How much of a drawing's scene text lists send. Every member gets every Team
 * drawing, so one huge scene would otherwise slow or break everyone's list.
 */
export const LIST_SEARCH_TEXT_LENGTH = 10_000

/** Every drawing column the client reads: the import source stays on the server. */
export const { excalidrawPlusId: _drawingSource, ...drawingColumns } =
  getTableColumns(drawings)

const { excalidrawPlusId: _folderSource, ...folderTableColumns } =
  getTableColumns(folders)

/**
 * Every folder column the client reads; see {@link drawingColumns}. The name
 * is cut to {@link MAX_NAME_LENGTH}, for rows saved before that limit.
 */
export const folderColumns = {
  ...folderTableColumns,
  name: sql<string>`left(${folders.name}, ${MAX_NAME_LENGTH})`,
}

const { data: _scene, ...columns } = drawingColumns

/**
 * Every client drawing column but the scene, plus the caller's `starred` flag.
 * Lists search the start of `searchText` instead, and a card fetches its scene
 * only once it scrolls into view. The name is cut as in {@link folderColumns}.
 * Needs `.leftJoin(stars, starOf(userId))`.
 */
export const drawingListColumns = {
  ...columns,
  name: sql<string>`left(${drawings.name}, ${MAX_NAME_LENGTH})`,
  searchText: sql<string>`left(${drawings.searchText}, ${LIST_SEARCH_TEXT_LENGTH})`,
  starred: sql<boolean>`${stars.userId} is not null`,
}

/** Join condition for the caller's own star on each drawing. */
export const starOf = (userId: string) =>
  and(eq(stars.drawingId, drawings.id), eq(stars.userId, userId))
