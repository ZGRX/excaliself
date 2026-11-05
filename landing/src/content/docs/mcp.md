---
title: Connect an AI client
description: Let Claude.ai, Claude Code, Claude Desktop, and other MCP clients find, read, create, and trash drawings.
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

## Tools

- `list_drawings`, `search_drawings`, and `list_folders` find drawings, with
  their space and folder.
- `read_drawing` describes a drawing: its shapes, text, and what the arrows
  connect. It does not send the raw Excalidraw JSON.
- `create_drawing` makes a new drawing in your private space or in Team,
  optionally in a folder, from simple shapes and arrows or a Mermaid flowchart.
- `create_folder` makes a folder in your private space or in Team, optionally
  inside another folder.
- `move_drawing` moves a drawing into a folder, or to the top of its space. A
  drawing cannot move between your private space and Team.
- `trash_drawing` and `trash_folder` move a drawing, or a folder with
  everything in it, to the trash. `restore_drawing` and `restore_folder` take
  them out again.

## Access

A token or a connected app acts as you: it sees what you see, and it can
trash what you can trash. It can create drawings and folders, and move
drawings between folders. It cannot change what is in a drawing, and it
cannot delete anything for good: trashed items stay in **Trash** for 30 days,
where any member who can see them can restore them. Under **Settings**, then
**MCP**, revoke a token or disconnect an app at any time.
When an admin deletes a member, that member's tokens and apps stop working.
