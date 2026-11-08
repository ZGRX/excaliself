// An exported SVG rasterized to PNG with resvg (WebAssembly, so the same build
// runs on every platform). resvg can't read woff2, so the fonts are decoded
// to TrueType first.

import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { readFontFile } from "./fonts"

/** Larger images are refused: a 4096 × 4096 bitmap. */
export const MAX_PNG_PIXELS = 4096 * 4096

// Both wasm packages load from node_modules when first used, not from the
// bundle: wawoff2 is Emscripten CommonJS that breaks once bundled, and resvg
// reads its .wasm beside itself. The Dockerfile copies both.
const require = createRequire(import.meta.url)
let resvg: Promise<typeof import("@resvg/resvg-wasm")> | undefined
let decompress: typeof import("wawoff2").decompress | undefined

function loadResvg() {
  resvg ??= (async () => {
    const module: typeof import("@resvg/resvg-wasm") =
      require("@resvg/resvg-wasm")
    await module.initWasm(
      await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    )
    return module
  })()
  // A failed load is retried next time.
  resvg.catch(() => {
    resvg = undefined
  })
  return resvg
}

let decoding: Promise<unknown> = Promise.resolve()

/**
 * woff2 → TrueType, one at a time: wawoff2 returns a view into its wasm heap,
 * which the next call overwrites, so each result is copied out first.
 */
function decodeFont(file: string): Promise<Uint8Array> {
  const decoded = decoding.then(async () => {
    decompress ??= require("wawoff2/decompress.js") as NonNullable<
      typeof decompress
    >
    return (await decompress(await readFontFile(file))).slice()
  })
  decoding = decoded.catch(() => {})
  return decoded
}

/** The SVG (from renderSvg with target "png") as PNG bytes. */
export async function rasterize(svg: string, fontFiles: string[]) {
  const { Resvg } = await loadResvg()
  const fontBuffers: Uint8Array[] = []
  for (const file of fontFiles) fontBuffers.push(await decodeFont(file))
  const renderer = new Resvg(svg, {
    font: { fontBuffers, defaultFontFamily: "Liberation Sans" },
  })
  try {
    const image = renderer.render()
    const png = image.asPng()
    image.free()
    return png
  } finally {
    renderer.free()
  }
}
