import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import type { Participant } from "@/features/collab/protocol"
import { FollowModeOverlay } from "./follow-mode-overlay"

afterEach(cleanup)

const wren: Participant = {
  connectionId: "peer-wren",
  name: "Wren",
  color: { background: "#fa5252", stroke: "#c92a2a" },
  isGuest: true,
  image: null,
}

const roomFollowing = (
  followedParticipant: Participant | null,
  stopFollowing: () => void = () => {},
) => ({
  others: [],
  followedParticipant,
  toggleFollow: () => {},
  stopFollowing,
})

test("following nobody draws no chrome", () => {
  const { container } = render(<FollowModeOverlay room={roomFollowing(null)} />)
  expect(container.firstChild).toBeNull()
})

test("the chip names who is being followed and how to stop", () => {
  render(<FollowModeOverlay room={roomFollowing(wren)} />)
  expect(
    screen.getByRole("button", { name: "Following Wren — click to stop" }),
  ).toBeTruthy()
})

test("the ring and the chip wear the followed person's cursor color", () => {
  const { container } = render(<FollowModeOverlay room={roomFollowing(wren)} />)
  const ring = container.firstChild as HTMLElement
  expect(ring.style.borderColor).toBe("rgb(250, 82, 82)")
  expect(screen.getByRole("button").style.backgroundColor).toBe(
    "rgb(250, 82, 82)",
  )
})

test("clicking the chip stops following", () => {
  const onStop = vi.fn()
  render(<FollowModeOverlay room={roomFollowing(wren, onStop)} />)
  screen.getByRole("button").click()
  expect(onStop).toHaveBeenCalledOnce()
})
