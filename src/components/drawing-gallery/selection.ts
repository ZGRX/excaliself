import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/**
 * The next selection after a click on `id`. A plain click toggles it; with
 * `extend` (shift) every card from the anchor to `id` is added, in grid order.
 */
export function nextSelection(
  selected: ReadonlySet<string>,
  order: readonly string[],
  id: string,
  extend: boolean,
  anchor: string | null,
): Set<string> {
  const next = new Set(selected)
  const from = anchor === null ? -1 : order.indexOf(anchor)
  const to = order.indexOf(id)
  if (extend && from !== -1 && to !== -1) {
    const [start, end] = from < to ? [from, to] : [to, from]
    for (const rangeId of order.slice(start, end + 1)) next.add(rangeId)
  } else if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// Escape belongs to an open menu, dialog, or text field first.
function escapeIsTaken(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  return (
    event.defaultPrevented ||
    target?.closest("input, textarea, [contenteditable=true]") != null ||
    document.querySelector(
      '[role="menu"], [role="dialog"], [role="alertdialog"]',
    ) != null
  )
}

/**
 * The gallery's multi-select over the cards in `order` (grid order). A card
 * that leaves the screen (trashed, moved out, filtered out) leaves the
 * selection for good, so it can't come back unseen. Escape clears.
 */
export function useGallerySelection(order: readonly string[]) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const anchor = useRef<string | null>(null)

  const selected = useMemo(
    () => new Set(order.filter((id) => chosen.has(id))),
    [order, chosen],
  )
  useEffect(() => {
    setChosen((current) =>
      current.size === selected.size ? current : selected,
    )
  }, [selected])

  const toggle = useCallback(
    (id: string, extend: boolean) => {
      setChosen((current) =>
        nextSelection(current, order, id, extend, anchor.current),
      )
      anchor.current = id
    },
    [order],
  )
  const selectAll = useCallback(() => setChosen(new Set(order)), [order])
  const clear = useCallback(() => {
    setChosen(new Set())
    anchor.current = null
  }, [])

  const active = selected.size > 0
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !escapeIsTaken(event)) clear()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [active, clear])

  return { selected, toggle, selectAll, clear }
}

export type GallerySelection = ReturnType<typeof useGallerySelection>
