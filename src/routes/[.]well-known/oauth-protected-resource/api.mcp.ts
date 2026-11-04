import { createFileRoute } from "@tanstack/react-router"
import {
  preflight,
  protectedResourceMetadata,
} from "@/features/oauth/endpoints"

// /api/mcp's metadata (RFC 9728), named in its 401.
export const Route = createFileRoute(
  "/.well-known/oauth-protected-resource/api/mcp",
)({
  server: {
    handlers: {
      GET: ({ request }) => protectedResourceMetadata(request),
      OPTIONS: preflight,
    },
  },
})
