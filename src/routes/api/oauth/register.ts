import { createFileRoute } from "@tanstack/react-router"
import { db } from "@/db"
import { preflight, register } from "@/features/oauth/endpoints"

export const Route = createFileRoute("/api/oauth/register")({
  server: {
    handlers: {
      POST: ({ request }) => register(db, request),
      OPTIONS: preflight,
    },
  },
})
