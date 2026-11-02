import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import { GitHubStarPrompt, shouldAskForStar } from "./GitHubStarPrompt"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 2)

test("asks only after a week and ten drawings", () => {
  const weekOld = new Date(now - 7 * DAY)
  expect(shouldAskForStar(weekOld, 10, now)).toBe(true)
  expect(shouldAskForStar(weekOld, 9, now)).toBe(false)
  expect(shouldAskForStar(new Date(now - 6 * DAY), 50, now)).toBe(false)
})

const renderPrompt = () =>
  render(
    <GitHubStarPrompt
      userId="admin-1"
      createdAt={new Date(Date.now() - 30 * DAY)}
      drawingCount={12}
    />,
  )

test("once dismissed, the prompt stays hidden", async () => {
  renderPrompt()
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }))
  expect(screen.queryByText("Enjoying Excaliself?")).toBeNull()

  cleanup()
  renderPrompt()
  expect(screen.queryByText("Enjoying Excaliself?")).toBeNull()
})
