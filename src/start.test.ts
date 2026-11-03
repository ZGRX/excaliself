import { expect, test, vi } from "vitest"
import { MAX_SERVER_FN_BODY_BYTES, serverFnBodyLimit } from "./start"

const limit = (
  init: RequestInit & { length?: number },
  handlerType: "serverFn" | "router" = "serverFn",
) => {
  const headers = new Headers(init.headers)
  if (init.length !== undefined)
    headers.set("content-length", String(init.length))
  const next = vi.fn(async () => "handled")
  const result = serverFnBodyLimit.options.server?.({
    request: new Request("http://app.test/_serverFn/abc", {
      method: "POST",
      ...init,
      headers,
    }),
    handlerType,
    pathname: "/_serverFn/abc",
    context: undefined,
    next: next as never,
  })
  return { result, next }
}

test("a server fn body over the cap is refused before anything reads it", async () => {
  const { result, next } = limit({ length: MAX_SERVER_FN_BODY_BYTES + 1 })

  expect(next).not.toHaveBeenCalled()
  expect(await result).toMatchObject({ status: 413 })
})

test("a server fn body that declares no length is refused", async () => {
  const { result, next } = limit({})

  expect(next).not.toHaveBeenCalled()
  expect(await result).toMatchObject({ status: 411 })
})

test("a server fn body at the cap goes through", async () => {
  const { result, next } = limit({ length: MAX_SERVER_FN_BODY_BYTES })

  expect(next).toHaveBeenCalled()
  expect(await result).toBe("handled")
})

test("GET server fns and other routes are not touched", async () => {
  expect(limit({ method: "GET" }).next).toHaveBeenCalled()
  expect(limit({}, "router").next).toHaveBeenCalled()
})
