import { expect, it, vi } from "vitest"
import { logPreviewSignIn } from "./preview-sign-in"

it.each([
  ["https://draw.example.com/", 4123, "https://draw.example.com/preview/login"],
  [undefined, 4123, "http://localhost:4123/preview/login"],
  [undefined, 3000, "http://localhost:3000/preview/login"],
])(
  "prints the sign-in URL for BASE_URL=%s and port=%s",
  (baseUrl, port, url) => {
    using log = vi.spyOn(console, "log").mockImplementation(() => {})

    logPreviewSignIn(baseUrl, port)

    expect(log).toHaveBeenCalledExactlyOnceWith(`[preview] Sign in at ${url}`)
  },
)
