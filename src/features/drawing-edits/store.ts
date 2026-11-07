// Changes an AI client proposed to a drawing, waiting for their member's
// Apply. In memory, per process: a restart drops them, and nothing was written.

import { randomUUID } from "node:crypto"
import type { SceneElement } from "@/features/collab/protocol"
import { processSingleton } from "@/lib/process-singleton"
import type { Revision } from "./apply"

export type EditStatus =
  | "pending"
  /** One tab claimed it and is applying it; it reports the outcome next. */
  | "applying"
  | "applied"
  | "discarded"
  /** The drawing changed under it before the Apply. */
  | "stale"
  /** A newer proposal for the same drawing took its place. */
  | "replaced"
  | "expired"
  /** Claimed, but the tab never reported the outcome (closed, or offline). */
  | "unconfirmed"

/** What the member's tab reports. */
export type Decision = "applying" | "applied" | "discarded" | "stale"

/** Which decisions each open status takes: a tab claims before it applies. */
const NEXT: Partial<Record<EditStatus, Decision[]>> = {
  pending: ["applying", "discarded"],
  applying: ["applied", "stale"],
}

export type DrawingEdit = {
  id: string
  drawingId: string
  userId: string
  /** The connected app's or access token's name. */
  client: string
  summary: string
  changes: string[]
  /** New and changed elements, whole. */
  elements: SceneElement[]
  /** Element id → the revision the edit was planned on. */
  base: Record<string, Revision>
  createdAt: number
  /** When a tab claimed it, for the claim's lease. */
  claimedAt: number | null
  status: EditStatus
}

export type ProposedEdit = Omit<
  DrawingEdit,
  "id" | "createdAt" | "claimedAt" | "status"
>

/** A pending edit expires after this. */
export const EDIT_TTL_MS = 30 * 60 * 1000

/** A claim the tab hasn't settled by then ends unconfirmed. */
export const CLAIM_LEASE_MS = 60 * 1000

export function createEditStore(now: () => number = () => Date.now()) {
  const edits = new Map<string, DrawingEdit>()
  const waiters = new Map<string, Set<() => void>>()

  const settle = (edit: DrawingEdit, status: EditStatus) => {
    edit.status = status
    // Waiters want the outcome, not the claim.
    if (status === "applying") return
    for (const wake of waiters.get(edit.id) ?? []) wake()
    waiters.delete(edit.id)
  }
  /** Expires on read, so no timer is needed. */
  const fresh = (edit: DrawingEdit) => {
    if (edit.status === "pending" && now() - edit.createdAt > EDIT_TTL_MS)
      settle(edit, "expired")
    if (
      edit.status === "applying" &&
      now() - (edit.claimedAt ?? 0) > CLAIM_LEASE_MS
    )
      settle(edit, "unconfirmed")
    return edit
  }
  const mine = (id: string, userId: string) => {
    const edit = edits.get(id)
    return edit?.userId === userId ? fresh(edit) : null
  }

  return {
    /** Stores a new edit, replacing the member's open one on that drawing. */
    propose(proposed: ProposedEdit): DrawingEdit {
      // Decided edits are kept a while, for a late status check.
      for (const [id, edit] of edits) {
        if (now() - edit.createdAt > 2 * EDIT_TTL_MS) edits.delete(id)
        else if (
          edit.userId === proposed.userId &&
          edit.drawingId === proposed.drawingId &&
          fresh(edit).status === "pending"
        )
          settle(edit, "replaced")
      }
      const edit: DrawingEdit = {
        ...proposed,
        id: randomUUID(),
        createdAt: now(),
        claimedAt: null,
        status: "pending",
      }
      edits.set(edit.id, edit)
      return edit
    },

    /** The member's open edit on a drawing. */
    pending(userId: string, drawingId: string): DrawingEdit | null {
      for (const edit of edits.values())
        if (
          edit.userId === userId &&
          edit.drawingId === drawingId &&
          fresh(edit).status === "pending"
        )
          return edit
      return null
    },

    /** The member's edit by id, or null for anyone else's. */
    get: mine,

    /**
     * First claim or discard wins; the claimer then reports applied or stale.
     * False for anything else, or for anyone else's edit.
     */
    decide(id: string, userId: string, decision: Decision): boolean {
      const edit = mine(id, userId)
      if (!edit || !NEXT[edit.status]?.includes(decision)) return false
      if (decision === "applying") edit.claimedAt = now()
      settle(edit, decision)
      return true
    },

    /** Resolves once the edit is decided, or after `ms`. */
    async wait(
      id: string,
      userId: string,
      ms: number,
    ): Promise<DrawingEdit | null> {
      const edit = mine(id, userId)
      if (!edit || !NEXT[edit.status]) return edit
      await new Promise<void>((resolve) => {
        const set = waiters.get(id) ?? new Set()
        waiters.set(id, set)
        const wake = () => {
          clearTimeout(timer)
          set.delete(wake)
          resolve()
        }
        const timer = setTimeout(wake, ms)
        set.add(wake)
      })
      return fresh(edit)
    },
  }
}

/** One per process: the MCP route and the server functions are separate bundles. */
export const drawingEdits = processSingleton("drawing-edits", () =>
  createEditStore(),
)
