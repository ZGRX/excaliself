// One per-IP budget of failed token lookups, shared by the share page and the
// ws upgrade. Only failures spend it and only failures are refused, so a live
// link always opens, even from an IP that someone else spent. It only slows
// guessing, which 256-bit tokens make hopeless anyway.

import { clientIpKey } from "@/lib/client-ip"
import { processSingleton } from "@/lib/process-singleton"
import { createRateLimiter } from "@/lib/rate-limit"

export const FAILED_TOKEN_LOOKUPS_PER_MINUTE = 60

type TokenRequest = { headers: Headers; socketIp?: string | null }

const limiter = processSingleton("share-token-rate-limit", () =>
  createRateLimiter({
    limit: FAILED_TOKEN_LOOKUPS_PER_MINUTE,
    windowMs: 60_000,
  }),
)

/** Call after a lookup fails. False once the budget is spent: refuse it. */
export function spendFailedTokenLookup(
  request: TokenRequest,
  now: number = Date.now(),
): boolean {
  return limiter.allow(clientIpKey(request), now)
}
