import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import type { Participant } from "@/features/collab/protocol"
import { PresenceAvatars } from "./presence-avatars"

afterEach(cleanup)

const participant = (name: string, i: number): Participant => ({
  connectionId: `peer-${i}`,
  name,
  color: { background: "#fa5252", stroke: "#c92a2a" },
  isGuest: true,
  image: null,
})

const renderAvatars = (props: {
  participants: readonly Participant[]
  followedConnectionId?: string | null
  onFollow?: (participant: Participant) => void
}) =>
  render(
    <PresenceAvatars
      room={{
        others: [...props.participants],
        followedParticipant:
          props.participants.find(
            (p) => p.connectionId === props.followedConnectionId,
          ) ?? null,
        toggleFollow: props.onFollow ?? (() => {}),
        stopFollowing: () => {},
      }}
    />,
  )

test("a room with nobody else in it shows no chrome", () => {
  const { container } = renderAvatars({ participants: [] })
  expect(container.firstChild).toBeNull()
})

test("each person in the room gets an avatar in their cursor color", () => {
  renderAvatars({
    participants: [participant("Ada Lovelace", 1), participant("Wren", 2)],
  })
  const ada = screen.getByTitle("Ada Lovelace")
  expect(ada.textContent).toBe("AL")
  expect((ada.firstElementChild as HTMLElement).style.backgroundColor).toBe(
    "rgb(250, 82, 82)",
  )
  expect(screen.getByTitle("Wren").textContent).toBe("W")
})

test("a crowd collapses into a +N tail", () => {
  renderAvatars({
    participants: ["A B", "C D", "E F", "G H", "I J", "K L"].map(participant),
  })
  expect(screen.getByText("+2")).toBeTruthy()
  expect(screen.getByLabelText("6 other people here")).toBeTruthy()
})

test("the label reads naturally for a single other person", () => {
  renderAvatars({ participants: [participant("Wren", 1)] })
  expect(screen.getByLabelText("1 other person here")).toBeTruthy()
})

test("clicking an avatar asks to follow that person", () => {
  const onFollow = vi.fn()
  const wren = participant("Wren", 1)
  renderAvatars({ participants: [wren], onFollow })

  screen.getByRole("button", { name: "Follow Wren" }).click()
  expect(onFollow).toHaveBeenCalledWith(wren)
})

test("the followed avatar offers to stop instead", () => {
  const onFollow = vi.fn()
  const wren = participant("Wren", 1)
  renderAvatars({
    participants: [wren],
    followedConnectionId: wren.connectionId,
    onFollow,
  })

  const avatar = screen.getByRole("button", { name: "Stop following Wren" })
  expect(avatar.getAttribute("aria-pressed")).toBe("true")
  avatar.click()
  expect(onFollow).toHaveBeenCalledWith(wren)
})
