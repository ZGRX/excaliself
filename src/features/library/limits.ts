// Caps on the team library. Every open editor downloads all of it again after
// each change, so they bound that download and how often it happens.

/** One item's JSON. */
export const MAX_LIBRARY_ITEM_BYTES = 1024 * 1024

/** The whole library's JSON, as the server sends it. */
export const MAX_LIBRARY_BYTES = 10 * 1024 * 1024

/** Saves per member, each one a refetch in every open editor. */
export const LIBRARY_CHANGES_PER_MINUTE = 60
