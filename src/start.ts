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

export const startInstance = createStart(() => ({
  requestMiddleware: [
    serverFnBodyLimit,
    // Start's default, which a start instance replaces.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  ],
}))
