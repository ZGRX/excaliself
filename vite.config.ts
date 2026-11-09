import { readFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import { MAX_FRAME_BYTES } from "./src/features/collab/frame-cap.ts"

/**
 * Nitro builds its crossws node adapter with no ws options, so ws would buffer
 * frames up to its 100 MiB default before the room handler sees them. Wrap the
 * adapter so ws refuses oversized frames from the header and closes with 1009.
 */
function wsFrameCap(): Plugin {
  const wrapperId = "\0ws-frame-cap"
  let adapterId = ""
  return {
    name: "ws-frame-cap",
    resolveId: {
      // Before Vite's resolver, which would claim the import first.
      order: "pre",
      async handler(source, importer) {
        if (source !== "crossws/adapters/node") return
        const adapter = await this.resolve(source, importer, { skipSelf: true })
        if (!adapter) throw new Error("ws-frame-cap: crossws adapter not found")
        adapterId = adapter.id
        return wrapperId
      },
    },
    load(id) {
      if (id !== wrapperId) return
      return `import nodeAdapter from ${JSON.stringify(adapterId)}
export default (options) => nodeAdapter({
  ...options,
  serverOptions: { ...options?.serverOptions, maxPayload: ${MAX_FRAME_BYTES} },
})`
    },
  }
}

/**
 * Nitro's Node entry owns the listener. Wrap its srvx call so the preview URL
 * is printed only after the listener has a bound port.
 */
function previewSignIn(): Plugin {
  const wrapperId = "\0preview-sign-in"
  let srvxId = ""
  return {
    name: "preview-sign-in",
    resolveId: {
      order: "pre",
      async handler(source, importer) {
        if (
          source !== "srvx/node" ||
          !importer?.endsWith("/presets/node/runtime/node-server.mjs")
        )
          return
        const srvx = await this.resolve(source, importer, { skipSelf: true })
        if (!srvx)
          throw new Error("preview-sign-in: srvx node adapter not found")
        srvxId = srvx.id
        return wrapperId
      },
    },
    load(id) {
      if (id !== wrapperId) return
      return `import { serve as serveNode } from ${JSON.stringify(srvxId)}
export * from ${JSON.stringify(srvxId)}
import { env } from "@/env"
import { logPreviewSignIn } from "@/lib/preview-sign-in"
export function serve(options) {
  const server = serveNode(options)
  if (env.PREVIEW_MODE) {
    const listener = server.node.server
    listener.once("listening", () => {
      const address = listener.address()
      if (address && typeof address !== "string") {
        logPreviewSignIn(env.BASE_URL, address.port)
      }
    })
  }
  return server
}`
    },
  }
}

/**
 * Serve Excalidraw's fonts from the app instead of its esm.sh default, so
 * visitors never reach a third party. Excalidraw fetches them from
 * `${window.EXCALIDRAW_ASSET_PATH}fonts/...`; __root.tsx sets that global.
 */
function excalidrawFonts(): Plugin {
  const pkgDir = fileURLToPath(
    new URL("./node_modules/@excalidraw/excalidraw/", import.meta.url),
  )
  const { version } = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8"),
  )
  const fontsDir = join(pkgDir, "dist/prod/fonts")
  // Under /assets/ for Nitro's immutable caching; versioned because some
  // font file names carry no hash.
  const buildBase = `assets/excalidraw-${version}/`
  return {
    name: "excalidraw-fonts",
    config: (_, { command }) => ({
      define: {
        // Dev serves the fonts straight from node_modules.
        __EXCALIDRAW_ASSET_PATH__: JSON.stringify(
          command === "serve" ? `/@fs${pkgDir}dist/prod/` : `/${buildBase}`,
        ),
      },
    }),
    async generateBundle() {
      if (this.environment.config.consumer !== "client") return
      const entries = await readdir(fontsDir, {
        recursive: true,
        withFileTypes: true,
      })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const path = join(entry.parentPath, entry.name)
        this.emitFile({
          type: "asset",
          fileName: `${buildBase}fonts/${relative(fontsDir, path)}`,
          source: await readFile(path),
        })
      }
    },
  }
}

const config = defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    devtools(),
    // `serverDir` turns on nitro's own file-based routing for the room
    // websocket (the app's pages stay with TanStack Start); `features.websocket`
    // wires the upgrade onto the app's existing port — no new ports, no new
    // env vars. Re-run docs/collab-websocket-smoke-test.md in both dev and the
    // built container after any nitro or TanStack Start upgrade.
    nitro({
      serverDir: "server",
      features: { websocket: true },
      rolldownConfig: {
        plugins: [wsFrameCap(), previewSignIn()],
        output: {
          codeSplitting: {
            groups: [
              {
                // The MCP image export draws with libraries Excalidraw also
                // bundles. Left to Nitro's groups, they join Excalidraw's
                // chunk, which then loads at startup and every request fails
                // with "window is not defined". A group of their own, taken
                // first, keeps Excalidraw off the server.
                name: "_libs/excalidraw-drawing",
                test: /[\\/]node_modules[\\/](roughjs|perfect-freehand|points-on-curve)[\\/]/,
                priority: 1,
              },
            ],
          },
        },
        checks: {
          // The server bundle inlines client libraries; their "use client"
          // directives mean nothing there and Rolldown warns on each one.
          moduleLevelDirective: false,
          // Nitro's chunk groups have no debugName, so the timing report
          // only adds a warning about the missing label.
          bundlerTimings: false,
        },
      },
    }),
    tanstackStart({
      router: {
        // Keep co-located *.test.tsx files out of route scanning so the
        // generator does not warn that they "do not export a Route".
        routeFileIgnorePattern: "\\.test\\.",
      },
    }),
    viteReact(),
    excalidrawFonts(),
  ],
})

export default config
