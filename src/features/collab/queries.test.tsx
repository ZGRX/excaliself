import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { POLL_INTERVAL_MS } from "@/lib/polling"
import type { LiveDrawing, LiveSnapshot } from "./live"
import type { Participant } from "./protocol"
import { useLiveDrawing, useRefreshLiveOnRoster } from "./queries"
import { getLiveDrawings } from "./server"

vi.mock("./server", () => ({ getLiveDrawings: vi.fn() }))

const color = { background: "#fa5252", stroke: "#c92a2a" }

const badge = (drawingId: string, count: number): LiveDrawing => ({
  drawingId,
  count,
  participants: [{ name: "Quiet Otter", color }],
})

const snapshot = (...drawings: LiveDrawing[]): LiveSnapshot => ({
  drawings,
  teamCount: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getLiveDrawings).mockResolvedValue(snapshot())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Row({ id }: { id: string }) {
  const live = useLiveDrawing(id)
  return <span data-testid={id}>{live ? `live:${live.count}` : "quiet"}</span>
}

const rowText = (id: string) => screen.getByTestId(id).textContent

function renderRows(ids: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      {ids.map((id) => (
        <Row key={id} id={id} />
      ))}
    </QueryClientProvider>,
  )
}

test("a drawing with a live room reports its count, the rest stay quiet", async () => {
  vi.mocked(getLiveDrawings).mockResolvedValue(snapshot(badge("d1", 3)))
  renderRows(["d1", "d2"])

  await waitFor(() => {
    expect(rowText("d1")).toBe("live:3")
  })
  expect(rowText("d2")).toBe("quiet")
})

test("every surface shares one poll loop", async () => {
  // Spec §1.5: gallery cards and sidebar chips read the same query key, so a
  // gallery of a hundred drawings still polls the server once per interval.
  renderRows(["d1", "d2", "d3", "d4"])

  await waitFor(() => {
    expect(getLiveDrawings).toHaveBeenCalledTimes(1)
  })
})

test("the badge refreshes on the poll interval", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  renderRows(["d1"])

  await waitFor(() => {
    expect(getLiveDrawings).toHaveBeenCalledTimes(1)
  })
  expect(rowText("d1")).toBe("quiet")

  vi.mocked(getLiveDrawings).mockResolvedValue(snapshot(badge("d1", 1)))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
  })

  await waitFor(() => {
    expect(rowText("d1")).toBe("live:1")
  })
})

function RoomRow({ id, others }: { id: string; others: Participant[] }) {
  useRefreshLiveOnRoster(others)
  return <Row id={id} />
}

test("a roster change in the open room refreshes the badge before the next poll", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = (others: Participant[]) => (
    <QueryClientProvider client={queryClient}>
      <RoomRow id="d1" others={others} />
    </QueryClientProvider>
  )
  const { rerender } = render(view([]))
  await waitFor(() => {
    expect(getLiveDrawings).toHaveBeenCalledTimes(1)
  })

  vi.mocked(getLiveDrawings).mockResolvedValue(snapshot(badge("d1", 1)))
  rerender(
    view([{ connectionId: "c2", name: "Quiet Otter", color, isGuest: false }]),
  )

  await waitFor(() => {
    expect(rowText("d1")).toBe("live:1")
  })
})
