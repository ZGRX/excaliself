/**
 * What a tab puts on the wire, ported from upstream's `Collab`/`Portal`. A
 * scene-version gate skips no-op `onChange`s; a per-element gate picks what changed.
 */

import { exceedsFrameCap, MAX_FRAME_BYTES, utf8ByteLength } from "./frame-cap"
import type { SceneElement } from "./protocol"
import { getSceneVersion } from "./reconcile"

/** Upstream's `SYNC_FULL_SCENE_INTERVAL_MS`. */
export const SYNC_FULL_SCENE_INTERVAL_MS = 20_000

/** Upstream's `DELETED_ELEMENT_TIMEOUT`. */
export const DELETED_ELEMENT_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * Tombstones stop syncing after a day; unstamped ones always sync. The Room
 * sends peers only these, so a guest never gets older deletions.
 */
export function isSyncableElement(element: SceneElement, now: number): boolean {
  if (!element.isDeleted) return true
  return typeof element.updated === "number"
    ? element.updated > now - DELETED_ELEMENT_TIMEOUT_MS
    : true
}

/** Room enough for `{"type":"SCENE_UPDATE","payload":{"elements":[]}}`, and then some. */
const FRAME_ENVELOPE_BYTES = 128

/**
 * Splits elements into frames under the server cap. An oversized frame closes
 * the socket (1009), and resending it on reconnect would loop forever.
 */
export function splitSceneFrames(
  elements: readonly SceneElement[],
  maxBytes: number = MAX_FRAME_BYTES,
): SceneElement[][] {
  if (elements.length === 0) return []
  const budget = maxBytes - FRAME_ENVELOPE_BYTES

  // Fast path for ordinary deltas, using the server's own size check.
  const serialized = JSON.stringify(elements)
  if (!exceedsFrameCap(serialized, budget)) return [[...elements]]

  const frames: SceneElement[][] = []
  let frame: SceneElement[] = []
  let frameBytes = 0
  for (const element of elements) {
    const bytes = utf8ByteLength(JSON.stringify(element)) + 1 // the comma
    // One element over the cap can't be split; drop it rather than kill the session.
    if (bytes > budget) {
      console.warn(
        `[collab] element ${element.id} is ${bytes} bytes — too large for one frame, not synced`,
      )
      continue
    }
    if (frame.length > 0 && frameBytes + bytes > budget) {
      frames.push(frame)
      frame = []
      frameBytes = 0
    }
    frame.push(element)
    frameBytes += bytes
  }
  if (frame.length > 0) frames.push(frame)
  return frames
}

export function createSceneBroadcaster(now: () => number = () => Date.now()) {
  /** The version of each element as the room last saw it, from either side. */
  const roomElementVersions = new Map<string, number>()
  /** Everything below this has already been sent or received. */
  let lastSceneVersion = -1

  function select(elements: readonly SceneElement[], syncAll: boolean) {
    const at = now()
    const selected = elements.filter(
      (element) =>
        isSyncableElement(element, at) &&
        (syncAll ||
          (roomElementVersions.get(element.id) ?? -1) < element.version),
    )
    for (const element of selected) {
      roomElementVersions.set(element.id, element.version)
    }
    return selected
  }

  return {
    /** Changed elements, or null if the scene hasn't moved (no echo of remote updates). */
    delta(elements: readonly SceneElement[]): SceneElement[] | null {
      const version = getSceneVersion(elements)
      if (version <= lastSceneVersion) return null
      lastSceneVersion = version
      return select(elements, false)
    },

    /** After SCENE_INIT: what the room lacks, even if the scene hasn't moved. */
    catchUp(elements: readonly SceneElement[]): SceneElement[] {
      lastSceneVersion = Math.max(lastSceneVersion, getSceneVersion(elements))
      return select(elements, false)
    },

    /** Everything syncable, to repair a peer that missed a frame. */
    full(elements: readonly SceneElement[]): SceneElement[] {
      lastSceneVersion = Math.max(lastSceneVersion, getSceneVersion(elements))
      return select(elements, true)
    },

    /** Call before `updateScene`, whose sync `onChange` would echo the merge. */
    received(
      remote: readonly SceneElement[],
      reconciled: readonly SceneElement[],
    ) {
      const kept = new Map(reconciled.map((element) => [element.id, element]))
      for (const element of remote) {
        // A local copy that won the merge (e.g. a version tie) is news to the room.
        if (kept.get(element.id)?.versionNonce !== element.versionNonce)
          continue
        const known = roomElementVersions.get(element.id) ?? -1
        if (element.version > known)
          roomElementVersions.set(element.id, element.version)
      }
      lastSceneVersion = getSceneVersion(reconciled)
    },
  }
}
