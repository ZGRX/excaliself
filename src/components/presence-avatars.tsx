import { UserAvatar } from "@/components/user-avatar"
import { initialsOf } from "@/features/collab/identity"
import type { RoomPresence } from "@/features/collab/use-room"
import { cn } from "@/lib/utils"

const MAX_AVATARS = 4

export function PresenceAvatars({
  room,
  className,
}: {
  room: RoomPresence
  className?: string
}) {
  const participants = room.others
  const followedConnectionId = room.followedParticipant?.connectionId
  if (participants.length === 0) return null

  const shown = participants.slice(0, MAX_AVATARS)
  const overflow = participants.length - shown.length

  return (
    <div
      className={cn("flex items-center -space-x-1.5", className)}
      aria-label={`${participants.length} other ${participants.length === 1 ? "person" : "people"} here`}
    >
      {shown.map((participant) => {
        const followed = participant.connectionId === followedConnectionId
        return (
          <button
            key={participant.connectionId}
            type="button"
            title={participant.name}
            aria-pressed={followed}
            aria-label={
              followed
                ? `Stop following ${participant.name}`
                : `Follow ${participant.name}`
            }
            onClick={() => room.toggleFollow(participant)}
            className="h-7 w-7 cursor-pointer rounded-full ring-2 ring-(--island-bg-color) transition-transform hover:scale-110"
            style={{
              boxShadow: followed
                ? `0 0 0 4px ${participant.color.background}`
                : undefined,
            }}
          >
            <UserAvatar
              initials={initialsOf(participant.name)}
              image={participant.image}
              className="size-full text-[0.625rem] text-white"
              style={{ backgroundColor: participant.color.background }}
            />
          </button>
        )
      })}
      {overflow > 0 && (
        <span className="flex h-7 items-center justify-center rounded-full bg-(--color-surface-low) px-1.5 text-[0.625rem] font-semibold text-(--color-on-surface) ring-2 ring-(--island-bg-color)">
          +{overflow}
        </span>
      )}
    </div>
  )
}
