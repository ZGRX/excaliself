import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/lib/auth"
import { clientIpKey, socketIpOf } from "@/lib/client-ip"

/**
 * better-auth keys its sign-in limiter on raw `X-Forwarded-For`, which a
 * client can rotate or omit. Hand it the app's trusted key as the only hop.
 */
export function authHandler(request: Request) {
  const key = clientIpKey({
    headers: request.headers,
    socketIp: socketIpOf(request),
  })
  // In place: srvx's request does not survive `new Request(request)`.
  request.headers.set("x-forwarded-for", key)
  return auth.handler(request)
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => authHandler(request),
      POST: ({ request }) => authHandler(request),
    },
  },
})
