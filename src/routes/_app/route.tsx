import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import type React from "react"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { currentUserQueryOptions } from "@/features/account/queries"
import { drawingsQueryOptions } from "@/features/drawings/queries"
import { foldersQueryOptions } from "@/features/folders/queries"
import { useListUpdates } from "@/features/list-updates/use-list-updates"
import { useSettingsShortcut } from "@/hooks/use-settings-shortcut"
import { useStoredTheme } from "@/hooks/use-theme"
import { authMiddleware } from "@/middleware/auth"
import { setupMiddleware } from "@/middleware/setup"
import { ActiveSpaceProvider } from "./-components/ActiveSpace"
import { CommandPaletteProvider } from "./-components/CommandPalette"
import { CreateDialogProvider } from "./-components/CreateDialog"
import { FirstVisitTour } from "./-components/FirstVisitTour"
import { MoveToTeamProvider } from "./-components/MoveToTeamDialog"
import { SidebarReopenButton } from "./-components/SidebarReopenButton"
import { DrawSidebar } from "./-components/sidebar"

// Only the user fields the shell reads. The session row holds the token.
const getSession = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { id, email, createdAt } = context.session.user
    return { user: { id, email, createdAt } }
  })

export const Route = createFileRoute("/_app")({
  server: {
    middleware: [setupMiddleware, authMiddleware],
  },
  loader: async ({ context }) => {
    const session = await getSession()
    // isAdmin comes from the currentUser query, which a self-demote updates,
    // so the admin-only chrome disappears right then (issue #65).
    const [user] = await Promise.all([
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
      context.queryClient.ensureQueryData(drawingsQueryOptions()),
      context.queryClient.ensureQueryData(foldersQueryOptions()),
    ])
    return { session, isAdmin: user.role === "admin" }
  },
  component: AppShellLayout,
})

function AppShellLayout() {
  const { session, isAdmin } = Route.useLoaderData()
  // The user card subscribes to the currentUser cache so an optimistic
  // profile save on /settings shows up in the sidebar in the same frame.
  const { data: currentUser } = useQuery(currentUserQueryOptions())
  useSettingsShortcut()
  // Applies this browser's stored theme choice (spec §4.4, device-scoped).
  useStoredTheme()
  // Teammates' creates, moves, and trashes show up without waiting for the poll.
  useListUpdates()

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "240px" } as React.CSSProperties}
    >
      <ActiveSpaceProvider>
        <CreateDialogProvider>
          <MoveToTeamProvider>
            <CommandPaletteProvider>
              <DrawSidebar
                user={{
                  id: session.user.id,
                  createdAt: session.user.createdAt,
                  email: currentUser?.email ?? session.user?.email ?? "",
                  name: currentUser?.name ?? null,
                  image: currentUser?.image ?? null,
                  isAdmin,
                }}
              />
              {/* The Etched panel look lives in the SidebarInset primitive. */}
              <SidebarInset className="overflow-clip">
                <SidebarReopenButton />
                <Outlet />
              </SidebarInset>
              <FirstVisitTour userId={session.user.id} />
            </CommandPaletteProvider>
          </MoveToTeamProvider>
        </CreateDialogProvider>
      </ActiveSpaceProvider>
    </SidebarProvider>
  )
}
