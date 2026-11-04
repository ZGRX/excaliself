import { createFileRoute } from "@tanstack/react-router"
import {
  preflight,
  protectedResourceMetadata,
} from "@/features/oauth/endpoints"

// Root form of the MCP endpoint's metadata, for clients that skip the path.
export const Route = createFileRoute("/.well-known/oauth-protected-resource/")({
  server: {
    handlers: {
      GET: ({ request }) => protectedResourceMetadata(request),
      OPTIONS: preflight,
    },
  },
})
