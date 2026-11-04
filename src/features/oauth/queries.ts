import { queryOptions } from "@tanstack/react-query"
import { getConnectedApps } from "./server"

export type ConnectedApp = Awaited<ReturnType<typeof getConnectedApps>>[number]

export const connectedAppsQueryOptions = () =>
  queryOptions({
    queryKey: ["account", "connectedApps"] as const,
    queryFn: () => getConnectedApps(),
  })
