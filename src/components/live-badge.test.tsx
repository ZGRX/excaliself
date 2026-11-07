import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import type { LiveDrawing, LiveParticipant } from "@/features/collab/live"
import { MAX_LIVE_AVATARS } from "@/features/collab/live"
import { LiveAvatarStack, LiveCountChip } from "./live-badge"

afterEach(cleanup)

const COLORS = ["#fa5252", "#4c6ef5", "#12b886", "#f59f00", "#7950f2"]

const person = (name: string, i = 0): LiveParticipant => ({
  name,
  color: { background: COLORS[i % COLORS.length], stroke: "#000000" },
  image: null,
})

const live = (names: string[], count = names.length): LiveDrawing => ({
  drawingId: "d1",
  count,
  participants: names.map(person),
})

test("nobody there means no badge at all on either surface", () => {
  const stack = render(<LiveAvatarStack live={null} />)
  expect(stack.container.firstChild).toBeNull()
  cleanup()
  const chip = render(<LiveCountChip live={null} />)
  expect(chip.container.firstChild).toBeNull()
})

test("each participant gets an initialed avatar in their own color", () => {
  render(<LiveAvatarStack live={live(["Ada Lovelace", "Quiet Otter"])} />)

  // The colors are the ones the cursors wear, so they have to survive intact.
  expect(screen.getByText("AL").parentElement?.style.backgroundColor).toBe(
    "rgb(250, 82, 82)",
  )
  expect(screen.getByText("QO").parentElement?.style.backgroundColor).toBe(
    "rgb(76, 110, 245)",
  )
})

test("the stack tails off into +N once it is past its cap", () => {
  const shown = Array.from({ length: MAX_LIVE_AVATARS }, (_, i) => `Guest ${i}`)
  render(<LiveAvatarStack live={live(shown, MAX_LIVE_AVATARS + 3)} />)

  expect(screen.getAllByText(/^G\d$/)).toHaveLength(MAX_LIVE_AVATARS)
  expect(screen.getByText("+3")).toBeTruthy()
})

test("the badge takes no clicks — a live card just opens its drawing", () => {
  // Both surfaces sit inside a link's hit area (spec §1.5: "clicking a live
  // card just opens the drawing"), so neither may swallow the click.
  const one = live(["Ada Lovelace"])
  const { container, rerender } = render(<LiveAvatarStack live={one} />)
  expect(container.firstElementChild?.className).toContain(
    "pointer-events-none",
  )

  rerender(<LiveCountChip live={one} />)
  expect(container.firstElementChild?.className).toContain(
    "pointer-events-none",
  )
})

test("a stack that fits shows no tail", () => {
  render(<LiveAvatarStack live={live(["Ada Lovelace", "Quiet Otter"])} />)
  expect(screen.queryByText(/^\+/)).toBeNull()
})

test("the sidebar chip is the true count, not the number of avatars", () => {
  render(<LiveCountChip live={live(["Ada Lovelace"], 7)} />)
  expect(screen.getByText("7")).toBeTruthy()
})

test("both surfaces say the same thing to a screen reader", () => {
  const alone = live(["Ada Lovelace"])
  const { rerender } = render(<LiveAvatarStack live={alone} />)
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "Ada Lovelace is in this drawing",
  )

  rerender(<LiveCountChip live={alone} />)
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "Ada Lovelace is in this drawing",
  )

  rerender(<LiveCountChip live={live(["Ada Lovelace"], 3)} />)
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "3 people are in this drawing",
  )
})
