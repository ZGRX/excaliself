// "Someone is in this drawing" badges. Ornament only: clicks fall through to
// the row's link.

import { UserAvatar } from "@/components/user-avatar"
import { initialsOf } from "@/features/collab/identity"
import type { LiveDrawing } from "@/features/collab/live"
import { cn } from "@/lib/utils"

function liveLabel(live: LiveDrawing): string {
  const [first] = live.participants
  if (live.count > 1) return `${live.count} people are in this drawing`
  return first
    ? `${first.name} is in this drawing`
    : "1 person is in this drawing"
}

/** Gallery card corner stack: overlapping faces, then a "+N" tail. */
export function LiveAvatarStack({
  live,
  className,
}: {
  live: LiveDrawing | null
  className?: string
}) {
  if (!live) return null

  const overflow = live.count - live.participants.length

  return (
    <div
      role="img"
      aria-label={liveLabel(live)}
      className={cn(
        "pointer-events-none flex items-center -space-x-1.5",
        className,
      )}
    >
      {live.participants.map((participant, i) => (
        <UserAvatar
          // Names can repeat and there are no ids, so index is the key.
          key={i}
          initials={initialsOf(participant.name)}
          image={participant.image}
          className="size-5 text-[9px] text-white ring-2 ring-card"
          style={{ backgroundColor: participant.color.background }}
        />
      ))}
      {overflow > 0 && (
        <span className="flex h-5 items-center justify-center rounded-full bg-secondary px-1.5 text-[9px] font-semibold text-muted-foreground ring-2 ring-card">
          +{overflow}
        </span>
      )}
    </div>
  )
}

/** Sidebar row count. */
export function LiveCountChip({
  live,
  className,
}: {
  live: LiveDrawing | null
  className?: string
}) {
  if (!live) return null

  return (
    <span
      role="img"
      aria-label={liveLabel(live)}
      className={cn(
        "pointer-events-none flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-live-muted px-1 text-[10px] font-semibold text-live tabular-nums",
        className,
      )}
    >
      {live.count}
    </span>
  )
}
