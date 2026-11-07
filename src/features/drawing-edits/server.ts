// The member's side of proposed drawing edits: their tab reads its open
// proposal and reports Apply, Discard, or a stale scene.

import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { listUpdates } from "@/features/list-updates/hub"
import { EDITS_CHANGED } from "@/features/list-updates/protocol"
import { authMiddleware } from "@/middleware/auth"
import { drawingEdits } from "./store"

/** The signed-in member's open proposal on a drawing, or null. */
export const getDrawingEdit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.string())
  .handler(({ data: drawingId, context }) => {
    const edit = drawingEdits.pending(context.session.user.id, drawingId)
    if (!edit) return null
    const { id, client, summary, base } = edit
    // A string: elements are untyped JSON, which server functions won't type.
    return {
      id,
      client,
      summary,
      base,
      elements: JSON.stringify(edit.elements),
    }
  })

/** False when another tab decided first, or the proposal was replaced or expired. */
export const decideDrawingEdit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string(),
      decision: z.enum(["applying", "applied", "discarded", "stale"]),
    }),
  )
  .handler(({ data, context }) => {
    const decided = drawingEdits.decide(
      data.id,
      context.session.user.id,
      data.decision,
    )
    // The member's other tabs drop the card.
    if (decided) listUpdates.notify(EDITS_CHANGED)
    return decided
  })
