// A drawing as an image file: SVG with its fonts embedded, or PNG.

import { MAX_PNG_PIXELS, rasterize } from "./png"
import { type ExportFile, type ExportOptions, renderSvg } from "./svg"

export type ImageFormat = "svg" | "png"

export type ExportedImage = {
  mimeType: "image/svg+xml" | "image/png"
  data: Buffer
  /** In pixels, scale included. */
  width: number
  height: number
}

/** Null when the drawing has nothing to draw. */
export async function exportImage(
  elements: readonly Record<string, unknown>[],
  files: Map<string, ExportFile>,
  options: Omit<ExportOptions, "target"> & { format: ImageFormat },
): Promise<ExportedImage | null> {
  const rendered = await renderSvg(elements, files, {
    ...options,
    target: options.format,
  })
  if (!rendered) return null
  const { svg, fontFiles } = rendered
  if (options.format === "svg") {
    return {
      mimeType: "image/svg+xml",
      data: Buffer.from(svg),
      width: Math.round(rendered.width),
      height: Math.round(rendered.height),
    }
  }
  const width = Math.round(rendered.width)
  const height = Math.round(rendered.height)
  if (width * height > MAX_PNG_PIXELS) {
    throw new Error(
      `At this scale the PNG would be ${width} × ${height} pixels, more than a PNG can have (4096 × 4096). Use a smaller scale, or SVG.`,
    )
  }
  return {
    mimeType: "image/png",
    data: Buffer.from(await rasterize(svg, fontFiles)),
    width,
    height,
  }
}
