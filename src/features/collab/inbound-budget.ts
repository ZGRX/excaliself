// What one room socket may send, as two token buckets. Generous on purpose:
// the byte burst fits a full scene's catch-up, and the rates sit well above
// a busy tab drawing while followed.

export const INBOUND_FRAMES_PER_SECOND = 250
export const INBOUND_FRAME_BURST = 500
export const INBOUND_BYTES_PER_SECOND = 4 * 1024 * 1024
export const INBOUND_BYTE_BURST = 32 * 1024 * 1024

export type InboundBudget = {
  /** Spends one frame of `size`; false, spending nothing, once either bucket is dry. */
  spend(size: number, now: number): boolean
}

export function createInboundBudget(now: number): InboundBudget {
  let frames = INBOUND_FRAME_BURST
  let bytes = INBOUND_BYTE_BURST
  let refilledAt = now

  return {
    spend(size, now) {
      const seconds = Math.max(0, now - refilledAt) / 1000
      refilledAt = now
      frames = Math.min(
        INBOUND_FRAME_BURST,
        frames + seconds * INBOUND_FRAMES_PER_SECOND,
      )
      bytes = Math.min(
        INBOUND_BYTE_BURST,
        bytes + seconds * INBOUND_BYTES_PER_SECOND,
      )
      if (frames < 1 || bytes < size) return false
      frames -= 1
      bytes -= size
      return true
    },
  }
}
