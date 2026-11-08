---
title: Team space
description: One shared space for the whole instance, next to each member's private space.
---

Every drawing and folder lives in one of two spaces:

- **Private** is yours. Only you see it.
- **Team** belongs to the whole instance. Every member can see and edit every
  Team drawing and folder, with no sharing step.

The **Private | Team** switch is in the sidebar. It appears once the instance
has a second member, or once Team holds something.

## Move work to Team

Use **Move to Team** on a private drawing or folder in the sidebar, or in the
**⋯** menu of a private drawing card. All members can then see and edit it. A
folder moves with everything in it.

The move is one-way: you cannot move an item back to Private.

## Editing in Team

Team drawings are always live. Members who open the same drawing see each
other's cursors and edits, and a badge shows who is in each drawing right now.
Each open Team drawing uses a WebSocket, so your
[reverse proxy](/docs/docker-compose/#reverse-proxy) must pass them through.

To bring in someone without an account, create a guest link. See
[Share and collaborate](/docs/sharing/#team-drawings).

## When a member leaves

A Team item stays when its creator is deleted. It then shows "Former member" as
its creator. The member's private items are deleted with the account. See
[Members and invites](/docs/members/#delete-a-member).
