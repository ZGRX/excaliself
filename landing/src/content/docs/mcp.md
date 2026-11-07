---
title: Connect an AI client
description: Let Claude.ai, Claude Code, Claude Desktop, and other MCP clients find, read, create, change, and trash drawings, with every change applied only by you.
---

Excaliself has an [MCP](https://modelcontextprotocol.io) server at `/api/mcp`.
Your AI client brings the model, so the instance needs no LLM API key.

Clients connect in one of two ways:

- **Sign in with OAuth.** Claude.ai and other clients that support OAuth
  open an Excaliself page where you sign in and click **Allow**. You need
  no token.
- **An access token.** In Excaliself, open **Settings**, then **MCP**, and
  click **New token**. Copy the token: you see it only once. Then add the
  server to your client, with your instance's URL and the token.

## Claude.ai

This works in Claude on the web, on desktop, and on mobile.

1. In Claude, open **Settings**, then **Connectors**, and click
   **Add custom connector**.
2. Give it a name, such as Excaliself, and enter the URL
   `https://<your instance>/api/mcp`. Leave the advanced OAuth settings
   empty.
3. Click **Connect**. Claude opens Excaliself. Sign in if you need to,
   with your password or single sign-on, and click **Allow**.

Anthropic's servers connect to your instance, not your browser. The instance
must be on the public internet over HTTPS, with an IPv4 address. If a
firewall stands in front of it, allow Claude's IP range `160.79.104.0/21`.

## Claude Code

The token dialog shows this command filled in:

```bash
claude mcp add --transport http excaliself https://draw.example.com/api/mcp \
  --header "Authorization: Bearer exs_..."
```

## Claude Desktop

Claude Desktop cannot send a token to a remote server itself, so it connects
through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), which needs
Node. Open **Settings**, then **Developer**, then **Edit Config**, add this to
`claude_desktop_config.json`, and restart Claude Desktop:

```json
{
  "mcpServers": {
    "excaliself": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://draw.example.com/api/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer exs_..." }
    }
  }
}
```

## Other clients

For clients that use Streamable HTTP, the URL is
`https://<your instance>/api/mcp`. A client that supports OAuth with
dynamic client registration signs in by itself. Otherwise, send the header
`Authorization: Bearer <token>`.

## Try it in preview mode

In [preview mode](/docs/environment/#previews), the instance has a public
access token for the example admin: `exs_preview-mode-public-token`. Use it
to try a client, or to let an MCP inspector list the tools, with no sign-in:

```bash
docker run -d --rm --name excaliself-preview -p 127.0.0.1:3000:3000 -e PREVIEW_MODE=true ghcr.io/maciekzygmunt/excaliself
claude mcp add --transport http excaliself-preview http://localhost:3000/api/mcp \
  --header "Authorization: Bearer exs_preview-mode-public-token"
```

Only preview mode makes this token. Other instances refuse it. Stop the
preview with `docker stop excaliself-preview`.

### Over stdio

With `MCP_STDIO=true`, the preview also serves MCP on its standard input and
output, so your client starts the container itself and stops it when it
quits. For Claude Code:

```bash
claude mcp add excaliself-preview -- docker run -i --rm -p 127.0.0.1:3000:3000 -e PREVIEW_MODE=true -e MCP_STDIO=true ghcr.io/maciekzygmunt/excaliself
```

For Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excaliself-preview": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "-p", "127.0.0.1:3000:3000",
        "-e", "PREVIEW_MODE=true", "-e", "MCP_STDIO=true",
        "ghcr.io/maciekzygmunt/excaliself"
      ]
    }
  }
}
```

The client acts as the example admin. To watch its drawings appear live,
open `http://localhost:3000/preview/login`. Without the `-p` option, the
client still works, but you can't open the app.

## Tools

- `list_drawings`, `search_drawings`, and `list_folders` find drawings, with
  their space and folder.
- `read_drawing` describes a drawing: its shapes, text, and what the arrows
  connect. It does not send the raw Excalidraw JSON.
- `create_drawing` makes a new drawing in your private space or in Team,
  optionally in a folder, from simple shapes and arrows or a Mermaid flowchart.
  Mermaid `style` lines color the nodes (`fill` and `stroke`, as hex or named colors).
- `edit_drawing` proposes a change to an existing drawing: shapes, text, and
  arrows to add, change, or remove. Nothing changes until you click **Apply**.
  See [Change a drawing](#change-a-drawing). `get_drawing_edit` tells the
  client whether you applied it.
- `create_folder` makes a folder in your private space or in Team, optionally
  inside another folder.
- `move_drawing` moves a drawing into a folder, or to the top of its space. A
  drawing cannot move between your private space and Team.
- `trash_drawing` and `trash_folder` move a drawing, or a folder with
  everything in it, to the trash. `restore_drawing` and `restore_folder` take
  them out again.

## Change a drawing

Ask your AI client for a change, for example "Add a CDN in front of the API".
The client reads the drawing and proposes the change. The drawing does not
change yet.

1. Open the drawing in Excaliself. The client gives you its link. If the
   drawing is open already, the proposal shows at once.
2. A card shows a preview of the drawing after the change: new elements in
   green, changed ones in blue, and removed ones in red. Click the preview to
   open it larger, on a canvas you can zoom and pan but not edit.
3. Click **Apply** or **Discard**.

On **Apply**, your browser makes the change on your canvas, as if you drew
it. Everyone with the drawing open sees it live, and you can undo it with
<kbd>⌘Z</kbd> or <kbd>Ctrl Z</kbd>. The client learns whether you applied or
discarded it.

- Only you see the card, in each of your tabs on that drawing. Other members
  and guests see the change only after you apply it.
- If someone changes the same shapes before you click **Apply**, nothing is
  applied. The client reads the drawing again and proposes the change again.
- A proposal expires after 30 minutes. A new proposal for the same drawing
  replaces the old one. Proposals are kept in memory, so a restart of the
  instance drops them, and nothing changes.

## Access

A token or a connected app acts as you: it sees what you see, and it can
trash what you can trash. It can create drawings and folders, and move
drawings between folders. It cannot change what is in a drawing until you
click **Apply**, and it cannot delete anything for good: trashed items stay
in **Trash** for 30 days,
where any member who can see them can restore them. Under **Settings**, then
**MCP**, revoke a token or disconnect an app at any time.
When an admin deletes a member, that member's tokens and apps stop working.
