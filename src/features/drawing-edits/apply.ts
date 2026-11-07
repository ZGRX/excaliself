// How a member's tab applies a proposed edit to its own canvas. From there
// the canvas's usual writer (the Room, or autosave) carries it.

/**
 * Which edit of an element this is. Both parts: two edits can share a
 * version, and the nonce picks the winner.
 */
export type Revision = { version: number; versionNonce: number }

type Versioned = Revision & { readonly id: string }

/** True when an element the edit changes is gone or has moved on since it was planned. */
export function isStale(
  current: readonly Versioned[],
  base: Record<string, Revision>,
): boolean {
  const byId = new Map(current.map((element) => [element.id, element]))
  return Object.entries(base).some(([id, { version, versionNonce }]) => {
    const element = byId.get(id)
    return element?.version !== version || element.versionNonce !== versionNonce
  })
}

/** The scene with the edit in it: changed elements replaced in place, new ones on top. */
export function withEdit<T extends Versioned>(
  current: readonly T[],
  edited: readonly T[],
): T[] {
  const byId = new Map(edited.map((element) => [element.id, element]))
  const known = new Set(current.map(({ id }) => id))
  return [
    ...current.map((element) => byId.get(element.id) ?? element),
    ...edited.filter(({ id }) => !known.has(id)),
  ]
}
