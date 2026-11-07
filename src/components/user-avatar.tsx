import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

// The one avatar for every surface a user appears on (sidebar user card,
// member lists, Team card creators, canvas presence). Shows the SSO profile
// picture (`users.image`) when it loads, the initials otherwise. Decorative:
// the accessible name lives in the adjacent text. Size via className
// (defaults to the sidebar's 24px).
export function UserAvatar({
  initials,
  image,
  className,
  style,
}: {
  initials: string
  image?: string | null
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        "size-6 select-none bg-iris-ring text-[10px] font-semibold text-iris-strong",
        className,
      )}
      style={style}
    >
      {image && (
        // No referrer: Google's photo host refuses some, and it tells the
        // IdP less about who is looking.
        <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback className="bg-transparent">{initials}</AvatarFallback>
    </Avatar>
  )
}
