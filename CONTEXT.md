# Ubiquitous Language

## Terms

### Home
The state of the canvas area when no drawing is open. Shown inside the normal app shell (sidebar visible) — not a standalone landing page. Presents recent Drawings (with Previews) and the create action; doubles as the empty state when the user has no Drawings yet. Also the landing spot after actions that orphan the user, such as deleting the currently open Drawing or following a link to a Drawing that no longer exists.

### Recent
Drawings ordered by when they were last edited (not created, not opened). Editing a Drawing is the only thing that makes it "recent".

### Drawing
A single Excalidraw document created by a member, living in a Space, identified by id, in that Space's folder tree shown in the sidebar.

### Space
Where a Drawing or folder lives: Private or Team. A folder's whole subtree is always in one Space. A member can see and act on an item iff they are its Creator or it is in Team; this one rule replaces every per-item ownership check.

### Private
One member's own Space. Only that member sees it. Works the way the app did before Team existed, Share links included. Every Drawing and folder made before Team is Private.

### Team
The instance's one shared Space. Every member sees and can do everything with every Team Drawing and folder, with no sharing step. Never called "Shared": "shared" means "has a Share link".

### Creator
The member who created a Drawing or folder. For a Private item, the only member who can see it. A Team item outlives its Creator: when that member is deleted, the item stays with no Creator ("Former member").

### Canvas area
The inset region to the right of the sidebar. Shows either an open Drawing or Home.

### Create dialog
The single way a Drawing or folder is created: a command-style dialog where the user types a name and confirms. Everything is deliberately named at birth; the app never creates a Drawing on the user's behalf.

### Gallery
The app's one grid of Drawing cards (Preview, name, folder attribution, edited-ago), ordered by Recent unless a Browse toolbar re-sorts it. Home shows it capped at 8; All drawings shows it whole; later surfaces (folder pages, trash) reuse it rather than fork it.

### All drawings
The browse surface at `/drawings`: the Gallery over every Drawing the user owns, uncapped, under the Browse toolbar. Reached from Home's "View all" link.

### Browse toolbar
The Gallery's filter chrome on All drawings: on-page search (the app's only inline filter — there is no search-results page), folder chips (All / one per folder / Unfiled) that scope the grid, and a sort dropdown (Last edited default / Date created / Name). Search and chip scope compose. While Team is on, search covers both Spaces even on a page scoped to one, and each match carries a Space label; the chips (the page Space's folders) still narrow it. Folder pages reuse it without the chip row.

### Preview
A non-interactive visual rendering of a Drawing's scene, shown on Gallery cards so drawings are recognizable by shape rather than name.

### Room
The live collaboration session around one shared or Team Drawing. Exists only while at least one participant (member or guest) is connected; holds the authoritative scene while live. There is at most one Room per Drawing. Guests enter through a Share link; members open a Team Drawing and enter by its id, with no link.

### Handoff
The swap of who owns a Drawing's stored data. An unshared Private Drawing is written directly by its Creator's canvas (autosave); the moment a Share link exists, or the Drawing moves to Team, the Room becomes the only writer, every tab edits through the socket, and the server refuses direct writes. Stopping sharing hands a Private Drawing back. A Team Drawing never hands back to a solo writer: it is always a Room, a Room of one when only one member has it open (ADR 0002). Both directions flush before they let go, so no edit lives only in the writer being retired.

### Share link
The one live edit link a Drawing can have (`/share/<token>`), minted and managed by the owner from the Share dialog. "Shared" is derived — a Drawing is shared iff its link exists; stopping sharing deletes it, regenerating replaces the token (old URL dies). Carries an Audience: `members` (any signed-in member of this instance, the default) or `anyone` (no account needed). A link whose token, Audience, or Drawing no longer checks out is dead — every dead link looks identical, revealing nothing about whether the Drawing exists.

### Participant
One socket connected to a Room, as everyone else in it sees it: a display name, an assigned cursor color, and whether it belongs to a member or a guest. Identified by a Connection id, never by a userId — a member's account never crosses the wire to a guest. A member's name comes from their session and cannot be set from the client; a guest's is a pseudonym it generates and keeps in its own browser.

### Connection id
The random id a socket is given when it joins a Room, and the only handle other Participants have on it. Ephemeral by design (spec §4.4): reconnecting produces a new one, so it is not an identity that can be tracked or blocked — abuse limits key on IP instead.

### Heartbeat
A tiny frame each Participant sends every ~25 s, and the answer the server sends back. It exists to be traffic: a Room where everyone is reading rather than drawing is a live session, and without it a reverse proxy's idle timeout would close the sockets out from under it. The answer is the second half — a Participant whose heartbeat goes unanswered treats its Connection as dead even though the socket still claims to be open, which is the only way a connection that died without saying so is ever noticed.

### Reconnecting
The state of a Participant whose socket has dropped: the canvas stays live and editable, edits keep landing locally, and the client dials the Room again on a jittered backoff, indefinitely. Announced by one quiet indicator and nothing else — no warning, no retry button, and never any "lost work" language, because there is none: the rejoin merges what was drawn during the outage with whatever the Room has. Two answers end it instead of another dial — the Room is full, or the Share link is dead.

### Following
A one-way arrangement between two Participants in a Room: the follower's canvas rides along with the followed Participant's viewport, marked by a ring in that Participant's color and a chip naming them. Started by clicking their avatar, ended by clicking the chip, their avatar, panning or zooming, or by them leaving. Nobody can be made to follow, and being followed changes nothing about what the followed Participant can do — only that their viewport is relayed to whoever is watching.

### Live badge
What a member sees on a Drawing they can see that has a Room with someone *else* in it — any Team Drawing, or a Private one they created: a stack of Participant avatars on the Gallery card, a count on the sidebar row. Their own connections never count, so a Drawing they alone have open wears no badge. Ambient rather than exact — it is polled, so it trails joins and leaves by up to half a minute, and it is not a control: clicking a badged card just opens the Drawing, which joins the Room.

### Scene image
An image on a Drawing's canvas, stored as bytes under a content-addressed file id that the image element on the scene points at. Bytes and elements travel separately in a Room: the element syncs like any other element, while the bytes go over a room-scoped HTTP endpoint the same Share link opens. An image is *saved* once its bytes are stored — which is the signal other Participants use to fetch them — *pending* until then, and *errored* when the store refused it (too large, or too many uploads), in which case nobody fetches it and everyone sees a placeholder.

### Team library
The instance's one set of reusable shapes and icons, shown in the editor's Library panel in every Drawing, Private or Team. Every member sees and edits the same items, stored on the server; a member's add or remove reaches teammates' open editors live. Guests on a Share link neither see nor change it. Not tied to the Team Space despite the name: it is the team's, not a Space's.

### Access token
A secret a member makes under Settings so their own AI client can use the instance over MCP (`/api/mcp`). It acts as that member under the same Space rule: it can find, read, and create Drawings, but never change or delete one, since a shared or Team Drawing has its Room as the only writer (Handoff). Shown once, when made. Revoking it, or deleting its member, ends it at once. Not a Share link: it opens no Room and has no Audience.

### Connected app
An AI client, such as a Claude.ai connector, that a member let in through OAuth instead of an Access token: the client asks, the member signs in and clicks Allow. Same access and same limits as an Access token. Listed beside the tokens in Settings, where the member disconnects it; disconnecting, or deleting its member, ends it at once.
