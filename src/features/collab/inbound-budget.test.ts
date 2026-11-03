import { expect, test } from "vitest"
import {
  createInboundBudget,
  INBOUND_BYTE_BURST,
  INBOUND_BYTES_PER_SECOND,
  INBOUND_FRAME_BURST,
  INBOUND_FRAMES_PER_SECOND,
} from "./inbound-budget"

test("a burst of frames past the budget is refused until it refills", () => {
  const budget = createInboundBudget(0)
  for (let i = 0; i < INBOUND_FRAME_BURST; i++)
    expect(budget.spend(10, 0)).toBe(true)

  expect(budget.spend(10, 0)).toBe(false)
  expect(budget.spend(10, 1000 / INBOUND_FRAMES_PER_SECOND)).toBe(true)
})

test("bytes past the budget are refused, and a refused frame spends nothing", () => {
  const budget = createInboundBudget(0)
  expect(budget.spend(INBOUND_BYTE_BURST - 100, 0)).toBe(true)

  expect(budget.spend(200, 0)).toBe(false)
  expect(budget.spend(100, 0)).toBe(true)
})

test("an idle socket refills to its burst, not past it", () => {
  const budget = createInboundBudget(0)
  budget.spend(INBOUND_BYTE_BURST, 0)

  const later = (10 * INBOUND_BYTE_BURST * 1000) / INBOUND_BYTES_PER_SECOND
  expect(budget.spend(INBOUND_BYTE_BURST, later)).toBe(true)
  expect(budget.spend(1, later)).toBe(false)
})
