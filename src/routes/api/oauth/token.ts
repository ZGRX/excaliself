import { createFileRoute } from "@tanstack/react-router"
import { db } from "@/db"
import { preflight, token } from "@/features/oauth/endpoints"

export const Route = createFileRoute("/api/oauth/token")({
  server: {
    handlers: {
      POST: ({ request }) => token(db, request),
      OPTIONS: preflight,
    },
  },
})
