import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type ConnectedApp,
  connectedAppsQueryOptions,
} from "@/features/oauth/queries"
import { disconnectApp } from "@/features/oauth/server"
import { useDelayedVisible } from "@/hooks/use-delayed-visible"
import { formatAgo } from "@/lib/relative-time"

// Apps a member connected over OAuth, such as a Claude.ai connector. Each
// row is one consent; Disconnect ends its tokens at once.
export function ConnectedAppsSection() {
  const { data: apps, isPending } = useQuery(connectedAppsQueryOptions())
  const showSkeleton = useDelayedVisible(isPending)

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Connected apps</h2>
        <p className="text-xs text-muted-foreground">
          Apps you signed in to Excaliself, such as a Claude.ai connector. They
          have the same access as a token.
        </p>
      </div>

      {isPending ? (
        showSkeleton ? (
          <AppsSkeleton />
        ) : null
      ) : (
        apps && <AppList apps={apps} />
      )}
    </section>
  )
}

function AppList({ apps }: { apps: ConnectedApp[] }) {
  const queryClient = useQueryClient()
  const appsKey = connectedAppsQueryOptions().queryKey
  const { mutate: disconnect } = useMutation({
    mutationFn: disconnectApp,
    onMutate: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: appsKey })
      queryClient.setQueryData<ConnectedApp[]>(appsKey, (list) =>
        list?.filter((app) => app.id !== data.id),
      )
    },
    onError: () => toast.error("Couldn't disconnect app"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: appsKey }),
  })

  if (apps.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground/60">
        No connected apps
      </p>
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      {apps.map((app) => (
        <li key={app.id} className="flex items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-foreground">
                {app.clientName}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {app.redirectHost}
              </span>
            </div>
            {/* Server and client can straddle a minute boundary */}
            <p
              suppressHydrationWarning
              className="truncate text-xs text-muted-foreground"
            >
              Connected {formatAgo(app.createdAt)} ·{" "}
              {app.lastUsedAt
                ? `Last used ${formatAgo(app.lastUsedAt)}`
                : "Never used"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => disconnect({ data: { id: app.id } })}
          >
            Disconnect
          </Button>
        </li>
      ))}
    </ul>
  )
}

// Mirrors the loaded layout: one app row.
function AppsSkeleton() {
  return (
    <div className="rounded-xl border border-border/60 px-4 py-3.5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
        <Skeleton className="h-3 w-56 motion-reduce:animate-none" />
      </div>
    </div>
  )
}
