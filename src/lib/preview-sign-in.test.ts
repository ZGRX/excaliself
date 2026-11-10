import { expect, it, vi } from "vitest"
import { logPreviewSignIn } from "./preview-sign-in"

it.each([
  [
    "https://draw.example.com/",
    4123,
    false,
    "https://draw.example.com/preview/login",
  ],
  [undefined, 4123, false, "http://localhost:4123/preview/login"],
  [undefined, 3000, false, "http://localhost:3000/preview/login"],
  [undefined, 4123, true, "https://localhost:4123/preview/login"],
  [
    "https://user:password@draw.example.com/",
    4123,
    false,
    "https://draw.example.com/preview/login",
  ],
  [
    "mailto:preview@example.com",
    4123,
    false,
    "http://localhost:4123/preview/login",
  ],
])(
  "prints the sign-in URL for BASE_URL=%s, port=%s and TLS=%s",
  (baseUrl, port, secure, url) => {
    using log = vi.spyOn(console, "log").mockImplementation(() => {})

    logPreviewSignIn(baseUrl, port, secure)

    expect(log).toHaveBeenCalledExactlyOnceWith(`[preview] Sign in at ${url}`)
  },
)
