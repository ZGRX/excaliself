import type {
  ExcalidrawImperativeAPI,
  OnUserFollowedPayload,
  SocketId,
} from "@excalidraw/excalidraw/types"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import type { ClientMessage, Participant } from "./protocol"
import { useFollow } from "./use-follow"

/**
 * The canvas package can't be imported under vitest (its dev build pulls a
 * JSON module without an import attribute), and its viewport math isn't ours
 * to test anyway. These stand-ins keep the two properties the hook actually
 * depends on: bounds derive from the current scroll, and applying bounds
 * moves the scroll.
 */
vi.mock("@excalidraw/excalidraw", () => ({
  getVisibleSceneBounds: ({
    scrollX,
    scrollY,
    width,
    height,
  }: {
    scrollX: number
    scrollY: number
    width: number
    height: number
  }) => [-scrollX, -scrollY, -scrollX + width, -scrollY + height],
  zoomToFitBounds: ({ bounds }: { bounds: readonly number[] }) => ({
    appState: { scrollX: -bounds[0], scrollY: -bounds[1], zoom: { value: 1 } },
  }),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const wren: Participant = {
  connectionId: "peer-wren",
  name: "Wren",
  color: { background: "#fa5252", stroke: "#c92a2a" },
  isGuest: true,
  image: null,
}

/**
 * Enough of Excalidraw's imperative API for follow mode: `updateScene` merges
 * into a recorded appState, and `onUserFollow` hands back the subscriber so a
 * test can fire the FOLLOW/UNFOLLOW the real canvas would.
 */
function fakeExcalidrawAPI() {
  let appState = {
    scrollX: -100,
    scrollY: -200,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    offsetLeft: 0,
    offsetTop: 0,
    userToFollow: null as unknown,
    followedBy: new Set<SocketId>(),
  }
  const subscribers: ((payload: OnUserFollowedPayload) => void)[] = []
  const api = {
    getAppState: () => appState,
    updateScene: ({ appState: next }: { appState?: object }) => {
      appState = { ...appState, ...next }
    },
    onUserFollow: (callback: (payload: OnUserFollowedPayload) => void) => {
      subscribers.push(callback)
      return () => {
        subscribers.splice(subscribers.indexOf(callback), 1)
      }
    },
  }
  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    state: () => appState,
    /** What Excalidraw emits once `appState.userToFollow` settles. */
    emitFollow: (payload: OnUserFollowedPayload) => {
      for (const subscriber of [...subscribers]) subscriber(payload)
    },
  }
}

function setup() {
  const excalidraw = fakeExcalidrawAPI()
  const sent: ClientMessage[] = []
  const socket = { backedUp: false }
  const rendered = renderHook(() =>
    useFollow({
      excalidrawAPI: excalidraw.api,
      send: (message) => {
        sent.push(message)
        return true
      },
      isBackedUp: () => socket.backedUp,
    }),
  )
  return {
    ...excalidraw,
    sent,
    socket,
    hook: rendered.result,
    unmount: rendered.unmount,
  }
}

const followed = (id: string): OnUserFollowedPayload => ({
  action: "FOLLOW",
  userToFollow: { socketId: id as SocketId, username: "Wren" },
})
const unfollowed = (id: string): OnUserFollowedPayload => ({
  action: "UNFOLLOW",
  userToFollow: { socketId: id as SocketId, username: "Wren" },
})

test("clicking an avatar asks Excalidraw to follow that socket", () => {
  const { hook, state } = setup()

  act(() => hook.current.toggleFollow(wren))

  expect(state().userToFollow).toEqual({
    socketId: "peer-wren",
    username: "Wren",
  })
})

test("clicking the avatar you are already following stops", () => {
  const { hook, state, emitFollow } = setup()

  act(() => hook.current.toggleFollow(wren))
  act(() => emitFollow(followed("peer-wren")))
  act(() => hook.current.toggleFollow(wren))

  expect(state().userToFollow).toBeNull()
})

test("the room hears about every follow and every stop", () => {
  const { hook, sent, emitFollow } = setup()

  act(() => emitFollow(followed("peer-wren")))
  expect(hook.current.followedConnectionId).toBe("peer-wren")
  expect(sent.at(-1)).toEqual({
    type: "USER_FOLLOW",
    payload: { followedConnectionId: "peer-wren" },
  })

  // Panning the canvas is Excalidraw's own interruption — it reaches us the
  // same way an explicit stop does.
  act(() => emitFollow(unfollowed("peer-wren")))
  expect(hook.current.followedConnectionId).toBeNull()
  expect(sent.at(-1)).toEqual({
    type: "USER_FOLLOW",
    payload: { followedConnectionId: null },
  })
})

test("a stale unfollow can't cancel the follow that replaced it", () => {
  const { hook, sent, emitFollow } = setup()

  act(() => emitFollow(followed("peer-wren")))
  act(() => emitFollow(unfollowed("peer-someone-else")))

  expect(hook.current.followedConnectionId).toBe("peer-wren")
  expect(sent.filter((m) => m.type === "USER_FOLLOW")).toHaveLength(1)
})

test("a canvas nobody is watching relays nothing", () => {
  const { hook, sent } = setup()

  act(() => hook.current.onScrollChange())

  expect(sent).toHaveLength(0)
})

test("gaining a follower relays the viewport at once, and on every scroll after", () => {
  vi.useFakeTimers()
  const { hook, sent } = setup()

  act(() =>
    hook.current.handleServerMessage({
      type: "FOLLOWED_BY",
      payload: { connectionIds: ["peer-ada"] },
    }),
  )
  expect(sent.at(-1)).toEqual({
    type: "USER_VISIBLE_SCENE_BOUNDS",
    payload: { bounds: [100, 200, 1100, 1000] },
  })

  act(() => {
    vi.advanceTimersByTime(100)
    hook.current.onScrollChange()
  })
  expect(
    sent.filter((m) => m.type === "USER_VISIBLE_SCENE_BOUNDS"),
  ).toHaveLength(2)
})

test("losing the last follower goes quiet again", () => {
  vi.useFakeTimers()
  const { hook, sent } = setup()

  act(() =>
    hook.current.handleServerMessage({
      type: "FOLLOWED_BY",
      payload: { connectionIds: [] },
    }),
  )
  act(() => hook.current.onScrollChange())

  expect(sent).toHaveLength(0)
})

test("the viewport of the person being followed moves the canvas", () => {
  const { hook, state, emitFollow } = setup()

  act(() => emitFollow(followed("peer-wren")))
  act(() =>
    hook.current.handleServerMessage({
      type: "USER_VISIBLE_SCENE_BOUNDS",
      payload: { connectionId: "peer-wren", bounds: [500, 500, 1500, 1300] },
    }),
  )

  expect(state().scrollX).toBe(-500)
  expect(state().scrollY).toBe(-500)
})

test("a viewport from anyone else is ignored", () => {
  const { hook, state, emitFollow } = setup()

  act(() => emitFollow(followed("peer-wren")))
  act(() =>
    hook.current.handleServerMessage({
      type: "USER_VISIBLE_SCENE_BOUNDS",
      payload: {
        connectionId: "peer-stranger",
        bounds: [500, 500, 1500, 1300],
      },
    }),
  )

  expect(state().scrollX).toBe(-100)
})

test("a dropped socket ends both sides of the arrangement", () => {
  const { hook, state, sent, emitFollow } = setup()

  act(() => emitFollow(followed("peer-wren")))
  act(() =>
    hook.current.handleServerMessage({
      type: "FOLLOWED_BY",
      payload: { connectionIds: ["peer-ada"] },
    }),
  )
  sent.length = 0

  act(() => hook.current.reset())

  expect(hook.current.followedConnectionId).toBeNull()
  expect(state().userToFollow).toBeNull()
  expect(state().followedBy.size).toBe(0)
  act(() => hook.current.onScrollChange())
  expect(sent).toHaveLength(0)
})

test("a backed-up socket drops viewport frames instead of queueing them", () => {
  vi.useFakeTimers()
  const { hook, sent, socket } = setup()

  act(() =>
    hook.current.handleServerMessage({
      type: "FOLLOWED_BY",
      payload: { connectionIds: ["peer-ada"] },
    }),
  )
  const beforeStall = sent.length

  socket.backedUp = true
  for (let i = 0; i < 5; i++) {
    act(() => {
      vi.advanceTimersByTime(40)
      hook.current.onScrollChange()
    })
  }
  expect(sent).toHaveLength(beforeStall)

  // Draining the buffer lets the channel pick straight back up.
  socket.backedUp = false
  act(() => {
    vi.advanceTimersByTime(40)
    hook.current.onScrollChange()
  })
  expect(sent).toHaveLength(beforeStall + 1)
})

test("the frame a congested socket refused still lands once it drains", () => {
  vi.useFakeTimers()
  const { hook, sent, socket } = setup()

  act(() =>
    hook.current.handleServerMessage({
      type: "FOLLOWED_BY",
      payload: { connectionIds: ["peer-ada"] },
    }),
  )
  const beforeStall = sent.length

  // A pan that ends while the socket is congested: the last frame is the one
  // that decides where the follower comes to rest, and no later scroll is
  // coming to supersede it.
  socket.backedUp = true
  act(() => {
    vi.advanceTimersByTime(40)
    hook.current.onScrollChange()
  })
  expect(sent).toHaveLength(beforeStall)

  socket.backedUp = false
  act(() => vi.advanceTimersByTime(100))
  expect(sent).toHaveLength(beforeStall + 1)
  expect(sent.at(-1)?.type).toBe("USER_VISIBLE_SCENE_BOUNDS")
})
