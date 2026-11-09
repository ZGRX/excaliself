import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { RECONNECT_MAX_DELAY_MS } from "@/lib/socket/backoff"
import {
  COMMENTS_CHANGED,
  EDITS_CHANGED,
  LIBRARY_CHANGED,
  LISTS_CHANGED,
  SIGNED_OUT_CLOSE_CODE,
} from "./protocol"
import { useListUpdates } from "./use-list-updates"

// The query modules import server functions; the hook only needs their keys.
vi.mock("@/features/drawings/server", () => ({}))
vi.mock("@/features/folders/server", () => ({}))

let sockets: FakeSocket[] = []

/** Enough of a WebSocket for the hook: open, inbound frames, and close. */
class FakeSocket {
  private listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(readonly url: string) {
    sockets.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }
  send() {}
  close(code = 1005) {
    this.emit("close", { code })
  }
  open() {
    this.emit("open", {})
  }
  receive(data: string) {
    this.emit("message", { data })
  }
  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function renderListUpdates() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const view = renderHook(() => useListUpdates(), { wrapper })
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([filters]) => filters?.queryKey)
  return { ...view, queryClient, invalidate, invalidatedKeys }
}

const waitOutBackoff = () =>
  act(() => {
    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS)
  })

beforeEach(() => {
  sockets = []
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", FakeSocket)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("a change refetches the drawing, folder, and trash lists", () => {
  const { invalidate, invalidatedKeys } = renderListUpdates()
  act(() => sockets[0].open())
  invalidate.mockClear()

  act(() => sockets[0].receive(LISTS_CHANGED))
  expect(invalidatedKeys()).toEqual([["drawings"], ["folders"], ["trash"]])
})

test("a library change refetches only the library", () => {
  const { invalidate, invalidatedKeys } = renderListUpdates()
  act(() => sockets[0].open())
  invalidate.mockClear()

  act(() => sockets[0].receive(LIBRARY_CHANGED))
  expect(invalidatedKeys()).toEqual([["library"]])
})

test("an edits change refetches only the proposed edits", () => {
  const { invalidate, invalidatedKeys } = renderListUpdates()
  act(() => sockets[0].open())
  invalidate.mockClear()

  act(() => sockets[0].receive(EDITS_CHANGED))
  expect(invalidatedKeys()).toEqual([["drawing-edits"]])
})

test("a comments change refetches only comments", () => {
  const { invalidate, invalidatedKeys } = renderListUpdates()
  act(() => sockets[0].open())
  invalidate.mockClear()

  act(() => sockets[0].receive(COMMENTS_CHANGED))
  expect(invalidatedKeys()).toEqual([["comments"]])
})

test("a change during this tab's own mutation waits for it to settle", async () => {
  // Query's notify batching runs on timers.
  vi.useRealTimers()
  const { queryClient, invalidate, invalidatedKeys } = renderListUpdates()
  act(() => sockets[0].open())
  invalidate.mockClear()
  // Made up front: execute() calls mutationFn only after a few ticks.
  let finish = () => {}
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  const mutation = queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: () => promise })
  const settled = mutation.execute(undefined)

  act(() => sockets[0].receive(LISTS_CHANGED))
  act(() => sockets[0].receive(LISTS_CHANGED))
  expect(invalidatedKeys()).toEqual([])

  await act(async () => {
    finish()
    await settled
  })
  await waitFor(() => expect(invalidatedKeys()).not.toEqual([]))
  expect(invalidatedKeys()).toEqual([["drawings"], ["folders"], ["trash"]])
})

test("each open catches up on changes the tab missed", () => {
  const { invalidate } = renderListUpdates()
  act(() => sockets[0].open())
  expect(invalidate).toHaveBeenCalledTimes(6)
  act(() => sockets[0].close(1006))

  waitOutBackoff()
  expect(sockets).toHaveLength(2)
  act(() => sockets[1].open())
  expect(invalidate).toHaveBeenCalledTimes(12)
})

test("a signed-out close stops dialing", () => {
  renderListUpdates()
  act(() => sockets[0].close(SIGNED_OUT_CLOSE_CODE))

  waitOutBackoff()
  expect(sockets).toHaveLength(1)
})

test("unmounting closes the socket without dialing again", () => {
  const { unmount } = renderListUpdates()
  act(() => sockets[0].open())
  unmount()

  waitOutBackoff()
  expect(sockets).toHaveLength(1)
})
