# AI edits are Proposals that the member's own tab applies

An AI client never writes a Drawing's scene. `edit_drawing` plans the change on the server and keeps it as a Proposal in memory. The member the client acts as sees it as a card on the Drawing, and on Apply their own tab puts the planned elements on its canvas as a normal local edit. From there the Drawing's one writer takes it: the Room for a Team or shared Drawing (ADR 0001, 0002), autosave for an unshared Private one.

We chose this over a server-side write because a server write needs a second writer in every case. For a live Room, it must merge as a fake peer. For a closed Team Drawing, it must load, merge, and flush a Room. For an open Private tab, it must push the change in, or that tab's autosave writes over it. And it can't promise that a person approved the change: an MCP client's own confirmation is skipped by "Always allow" and by allow-listed tools. With a tab-side Apply, the only write path is the one a person's edit already takes, and the approval is the click itself.

## Consequences

- Nothing changes until the member opens the Drawing and clicks Apply. A Proposal on a Drawing nobody has open waits for that; opening a Team Drawing joins its Room as usual.
- The Apply is one undo step on that tab, and teammates get it live like any edit.
- Apply first claims the Proposal on the server, so one that another tab decided, a newer one replaced, or that expired never reaches a canvas. Only then does the tab check and apply, with no wait between, and report the outcome. A claim not settled within a minute (the tab closed, or went offline) ends "unconfirmed", and the client reads the Drawing to see what landed.
- The plan bumps each changed element's version once and records the version it was planned on. If any of those elements moved on before the Apply, the tab applies nothing and reports the Proposal stale; the client reads the Drawing again.
- Proposals live in process memory (`processSingleton`), like Rooms: a restart drops them, which loses nothing, since nothing was written.
- `edit_drawing` waits up to 25 s for the decision, so a member with the Drawing open answers within one tool call; otherwise the client asks again with `get_drawing_edit`.
