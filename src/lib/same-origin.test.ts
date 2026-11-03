import { beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "@/env"
import { fromOwnOrigin } from "./same-origin"

vi.mock("@/env", () => ({ env: {} }))

const request = (headers: Record<string, string>) =>
  new Request("http://internal:3000/ws/lists", { headers })

beforeEach(() => {
  Object.assign(env, { BASE_URL: undefined, PREVIEW_MODE: false })
})

describe("fromOwnOrigin", () => {
  it("trusts Sec-Fetch-Site over Origin", () => {
    expect(fromOwnOrigin(request({ "sec-fetch-site": "same-origin" }))).toBe(
      true,
    )
    for (const site of ["same-site", "cross-site", "none"])
      expect(
        fromOwnOrigin(
          request({ "sec-fetch-site": site, origin: "http://internal:3000" }),
        ),
      ).toBe(false)
  })

  it("without Sec-Fetch-Site, needs Origin to be the BASE_URL origin", () => {
    Object.assign(env, { BASE_URL: "https://draw.example.com" })
    expect(fromOwnOrigin(request({ origin: "https://draw.example.com" }))).toBe(
      true,
    )
    expect(fromOwnOrigin(request({ origin: "http://internal:3000" }))).toBe(
      false,
    )
    expect(
      fromOwnOrigin(request({ origin: "https://42.draw.example.com" })),
    ).toBe(false)
  })

  it("without BASE_URL, or in preview, compares with the forwarded origin", () => {
    Object.assign(env, {
      BASE_URL: "https://draw.example.com",
      PREVIEW_MODE: true,
    })
    const preview = {
      "x-forwarded-host": "42.draw.example.com",
      "x-forwarded-proto": "https",
    }
    expect(
      fromOwnOrigin(
        request({ ...preview, origin: "https://42.draw.example.com" }),
      ),
    ).toBe(true)
    expect(
      fromOwnOrigin(
        request({ ...preview, origin: "https://draw.example.com" }),
      ),
    ).toBe(false)
  })

  it("reads a socket's forwarded ws/wss proto as its page's http/https", () => {
    const socket = (proto: string, origin: string) =>
      request({ host: "draw.example.com", "x-forwarded-proto": proto, origin })
    expect(fromOwnOrigin(socket("wss", "https://draw.example.com"))).toBe(true)
    expect(fromOwnOrigin(socket("ws", "http://draw.example.com"))).toBe(true)
    expect(fromOwnOrigin(socket("ws", "https://draw.example.com"))).toBe(false)
  })

  it("lets non-browser clients through: they carry no ambient cookie", () => {
    expect(fromOwnOrigin(request({}))).toBe(true)
  })
})
