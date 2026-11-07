// MCP_STDIO: serves MCP over stdin/stdout next to the HTTP app, for AI clients
// that start the server themselves (`docker run -i`). Same tools as /api/mcp,
// acting as the preview admin; env.ts allows it only in preview mode.

import { Writable } from "node:stream"
import { definePlugin } from "nitro"
import { env } from "@/env"

export default definePlugin(() => {
  if (!env.MCP_STDIO) return
  // stdout carries only MCP messages, so every other write goes to stderr.
  const writeStdout = process.stdout.write.bind(process.stdout)
  const mcpOut = new Writable({
    write: (chunk, _encoding, callback) => writeStdout(chunk, callback),
  })
  process.stdout.write = process.stderr.write.bind(process.stderr)
  serve(mcpOut).catch((error) => {
    console.error("[mcp-stdio] failed to start", error)
    process.exit(1)
  })
})

// Imported on demand, so a server without MCP_STDIO loads none of it.
async function serve(out: Writable) {
  const [{ db }, { demoAdmin }, { createMcpServer }, stdio] = await Promise.all(
    [
      import("@/db"),
      import("@/db/demo-content"),
      import("@/features/mcp/tools"),
      import("@modelcontextprotocol/server/stdio"),
    ],
  )
  const origin = `http://localhost:${process.env.PORT || 3000}`
  stdio.serveStdio(
    () =>
      createMcpServer(
        db,
        { ...demoAdmin, client: "A local AI client" },
        origin,
      ),
    {
      transport: new stdio.StdioServerTransport(process.stdin, out),
      onerror: (error) => console.error("[mcp-stdio]", error),
    },
  )
  // The client closed its end: shut down like a deploy does (Rooms flush,
  // sockets close), so `docker run -i --rm` ends too.
  process.stdin.once("end", () => process.kill(process.pid, "SIGTERM"))
}
