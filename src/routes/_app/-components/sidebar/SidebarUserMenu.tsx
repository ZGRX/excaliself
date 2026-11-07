import { Link } from "@tanstack/react-router"
import { LogOut, Settings, Users } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user-avatar"
import { userDisplayName, userInitials } from "@/features/account/display-name"
import { authClient } from "@/lib/auth-client"

export type SidebarUser = {
  id: string
  createdAt: Date
  email: string
  name: string | null
  image: string | null
  isAdmin: boolean
}

export function SidebarUserMenu({ user }: { user: SidebarUser }) {
  const displayName = userDisplayName(user)
  return (
    <DropdownMenu>
      {/* A quiet avatar row, not a card — per the prototype; the wash on
          hover is the only added affordance for the menu it opens. */}
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 pt-1.5 pb-1 transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none"
          />
        }
      >
        <UserAvatar
          initials={userInitials(user)}
          image={user.image}
          className="size-5.5"
        />
        <span className="truncate text-[12px] opacity-60">{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--anchor-width) min-w-56 rounded-lg"
        side="top"
        align="start"
        sideOffset={4}
      >
        {user.isAdmin && (
          <>
            <DropdownMenuItem render={<Link to="/settings/members" />}>
              <Users className="mr-2 h-4 w-4" />
              Members
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut()
            window.location.href = "/login"
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
