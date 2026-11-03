import { env } from "@/env"
import { resolveOrigin } from "@/lib/site-origin"

/**
 * Whether a cookie-authenticated request comes from the instance's own pages.
 * SameSite=Lax still sends the cookie from sibling subdomains (PR previews).
 * Server functions get this check from TanStack's CSRF middleware; sockets and
 * server routes call this. Same rule: Sec-Fetch-Site, else Origin (WebSocket
 * handshakes carry only Origin). With neither, it is not a browser, so there
 * is no ambient cookie to abuse.
 */
export function fromOwnOrigin(request: Request): boolean {
  const { headers } = request
  const fetchSite = headers.get("sec-fetch-site")
  if (fetchSite !== null) return fetchSite === "same-origin"
  const origin = headers.get("origin")
  if (origin === null) return true
  // Preview ignores BASE_URL: Coolify may copy in the production value.
  const baseUrl = env.PREVIEW_MODE ? undefined : env.BASE_URL
  const own = resolveOrigin({ baseUrl, headers, requestUrl: request.url })
  // Proxies forward a socket's proto as ws/wss; its page is http/https.
  return origin === own.replace(/^ws(s?):/, "http$1:")
}
