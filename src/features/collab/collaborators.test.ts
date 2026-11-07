import { expect, test } from "vitest"
import { toCollaborators } from "./collaborators"
import type { Participant, PointerUpdate } from "./protocol"

const participant = (connectionId: string, name: string): Participant => ({
  connectionId,
  name,
  color: { background: "#fa5252", stroke: "#c92a2a" },
  isGuest: true,
  image: null,
})

const cursor: PointerUpdate = {
  pointer: { x: 10, y: 20, tool: "pointer" },
  button: "down",
  selectedElementIds: { el: true },
}

test("a peer's cursor is rendered under its connection id, with its name and color", () => {
  const collaborators = toCollaborators({
    participants: [participant("peer-a", "Wren")],
    pointers: new Map([["peer-a", cursor]]),
    selfConnectionId: "peer-self",
  })

  expect(collaborators.get("peer-a" as never)).toEqual({
    id: "peer-a",
    socketId: "peer-a",
    username: "Wren",
    color: { background: "#fa5252", stroke: "#c92a2a" },
    pointer: { x: 10, y: 20, tool: "pointer" },
    button: "down",
    selectedElementIds: { el: true },
  })
})

test("your own tab is never drawn as a collaborator", () => {
  const collaborators = toCollaborators({
    participants: [
      participant("peer-self", "You"),
      participant("peer-a", "Wren"),
    ],
    pointers: new Map(),
    selfConnectionId: "peer-self",
  })

  expect([...collaborators.keys()]).toEqual(["peer-a"])
})

test("a peer that hasn't moved yet appears without a cursor", () => {
  const collaborators = toCollaborators({
    participants: [participant("peer-a", "Wren")],
    pointers: new Map(),
    selfConnectionId: null,
  })

  expect(collaborators.get("peer-a" as never)?.pointer).toBeUndefined()
})

test("a departed peer's cursor goes with them", () => {
  const pointers = new Map([["peer-a", cursor]])
  const collaborators = toCollaborators({
    participants: [],
    pointers,
    selfConnectionId: null,
  })

  expect(collaborators.size).toBe(0)
})
