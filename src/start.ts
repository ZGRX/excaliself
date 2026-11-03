import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start"

/**
 * Start reads a server fn's whole body before auth runs. Twice the largest
 * real call: an import carrying a drawing's 20 MB of images as base64.
 */
export const MAX_SERVER_FN_BODY_BYTES = 64 * 1024 * 1024

/**
 * Refuses on `content-length`, before anything reads the body. Node's parser
 * stops at the declared length; the app's own calls always declare one.
 */
export const serverFnBodyLimit = createMiddleware().server(
  ({ request, handlerType, next }) => {
    if (handlerType !== "serverFn" || request.method !== "POST") return next()
    const declared = request.headers.get("content-length")
    if (declared === null)
      return new Response("Length Required", { status: 411 })
    if (!(Number(declared) <= MAX_SERVER_FN_BODY_BYTES))
      return new Response("Payload Too Large", { status: 413 })
    return next()
  },
)

/**
 * Pages and server fns can carry the member's data, so a shared cache (such as
 * a CDN that caches `.css` paths) must not store them. A route that sets its
 * own Cache-Control keeps it.
 */
export const noStoreByDefault = createMiddleware().server(async ({ next }) => {
  const result = await next()
  const { headers } = result.response
  if (!headers.has("cache-control"))
    headers.set("cache-control", "private, no-store")
  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    noStoreByDefault,
    serverFnBodyLimit,
    // Start's default, which a start instance replaces.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  ],
}))
