import { createFileRoute } from "@tanstack/react-router"
import {
  authorizationServerMetadata,
  preflight,
} from "@/features/oauth/endpoints"

export const Route = createFileRoute("/.well-known/oauth-authorization-server")(
  {
    server: {
      handlers: {
        GET: ({ request }) => authorizationServerMetadata(request),
        OPTIONS: preflight,
      },
    },
  },
)
