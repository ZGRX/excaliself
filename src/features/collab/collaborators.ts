// Rebuilt from the roster, not patched, so a leaver's cursor can't linger.

import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types"
import type { Participant, PointerUpdate } from "./protocol"

export function toCollaborators(input: {
  participants: readonly Participant[]
  /** Last cursor seen per connection id. */
  pointers: ReadonlyMap<string, PointerUpdate>
  /** This tab's own connection id, which Excalidraw must not draw. */
  selfConnectionId: string | null
}): Map<SocketId, Collaborator> {
  const collaborators = new Map<SocketId, Collaborator>()
  for (const participant of input.participants) {
    if (participant.connectionId === input.selfConnectionId) continue
    const socketId = participant.connectionId as SocketId
    const cursor = input.pointers.get(participant.connectionId)
    collaborators.set(socketId, {
      id: participant.connectionId,
      socketId,
      username: participant.name,
      avatarUrl: participant.image ?? undefined,
      color: participant.color,
      pointer: cursor?.pointer,
      button: cursor?.button,
      selectedElementIds: cursor?.selectedElementIds,
    })
  }
  return collaborators
}
