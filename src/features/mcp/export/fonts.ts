// Excalidraw's text fonts: metrics for laying out lines (from 0.18.1's
// fonts/FontMetadata.ts), and the font files an export needs: an SVG embeds
// them, so text looks the same in any viewer, even inside an <img>; a PNG
// hands them to the rasterizer.

import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { FONT_FILES } from "./font-files"

type Metrics = {
  unitsPerEm: number
  ascender: number
  descender: number
  lineHeight: number
}

export type FontTarget = "svg" | "png"

type Family = {
  name: string
  metrics: Metrics
  handDrawn?: true
  /** The family name inside the font files, which the rasterizer matches. */
  fileName?: string
}

const EXCALIFONT_METRICS = {
  unitsPerEm: 1000,
  ascender: 886,
  descender: -374,
  lineHeight: 1.25,
}

/** By an element's `fontFamily` number. */
const FAMILIES: Record<number, Family> = {
  1: { name: "Virgil", metrics: EXCALIFONT_METRICS },
  2: {
    name: "Helvetica",
    metrics: {
      unitsPerEm: 2048,
      ascender: 1577,
      descender: -471,
      lineHeight: 1.15,
    },
  },
  3: {
    name: "Cascadia",
    fileName: "Cascadia Code",
    metrics: {
      unitsPerEm: 2048,
      ascender: 1900,
      descender: -480,
      lineHeight: 1.2,
    },
  },
  5: { name: "Excalifont", metrics: EXCALIFONT_METRICS, handDrawn: true },
  6: {
    name: "Nunito",
    fileName: "Nunito ExtraLight",
    metrics: {
      unitsPerEm: 1000,
      ascender: 1011,
      descender: -353,
      lineHeight: 1.35,
    },
  },
  7: {
    name: "Lilita One",
    metrics: {
      unitsPerEm: 1000,
      ascender: 923,
      descender: -220,
      lineHeight: 1.15,
    },
  },
  8: {
    name: "Comic Shanns",
    fileName: "Comic Shanns Regular",
    metrics: {
      unitsPerEm: 1000,
      ascender: 750,
      descender: -250,
      lineHeight: 1.25,
    },
  },
  9: {
    name: "Liberation Sans",
    metrics: {
      unitsPerEm: 2048,
      ascender: 1854,
      descender: -434,
      lineHeight: 1.15,
    },
  },
}

const CJK_FALLBACK = "Xiaolai"
const CJK_FALLBACK_FILE_NAME = "Xiaolai SC"
const EMOJI_FALLBACK = "Segoe UI Emoji"
const HELVETICA = 2
const LIBERATION = 9

/**
 * The family a text renders in. Helvetica is a system font, so a PNG uses
 * Liberation Sans instead, as Excalidraw's own server-side export does.
 */
const familyOf = (
  fontFamily: number,
  target: FontTarget,
): Family | undefined =>
  target === "svg"
    ? FAMILIES[fontFamily]
    : fontFamily === HELVETICA
      ? FAMILIES[LIBERATION]
      : (FAMILIES[fontFamily] ?? FAMILIES[5])

/**
 * The family list a text's `font-family` gets: Excalidraw's for an SVG; the
 * names inside the font files for a PNG, which has no system emoji font.
 */
export function fontFamilyString(fontFamily: number, target: FontTarget) {
  const family = familyOf(fontFamily, target)
  if (target === "svg") {
    if (!family) return EMOJI_FALLBACK
    return family.handDrawn
      ? `${family.name}, ${CJK_FALLBACK}, ${EMOJI_FALLBACK}`
      : `${family.name}, ${EMOJI_FALLBACK}`
  }
  if (!family) return EMOJI_FALLBACK
  const name = family.fileName ?? family.name
  return family.handDrawn ? `${name}, ${CJK_FALLBACK_FILE_NAME}` : name
}

/** The line height a text without one gets. */
export const defaultLineHeight = (fontFamily: number) =>
  (FAMILIES[fontFamily] ?? FAMILIES[5]).metrics.lineHeight

/** Where the alphabetic baseline of a text's first line sits. */
export function verticalOffset(
  fontFamily: number,
  fontSize: number,
  lineHeightPx: number,
) {
  const { unitsPerEm, ascender, descender } = (
    FAMILIES[fontFamily] ?? FAMILIES[1]
  ).metrics
  const em = fontSize / unitsPerEm
  const lineGap = (lineHeightPx - em * ascender + em * descender) / 2
  return em * ascender + lineGap
}

const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}　-〿＀-￯]/u
const codePointOf = (char: string) => char.codePointAt(0) ?? 0

const decodeRanges = (ranges: string) =>
  ranges.split(",").map((run) => {
    const [start, end = start] = run.split("-")
    return [Number.parseInt(start, 36), Number.parseInt(end, 36)] as const
  })

const FILES_BY_FAMILY = new Map(
  Object.entries(FONT_FILES).map(([family, files]) => [
    family,
    files.map(([file, ranges]) => ({ file, ranges: decodeRanges(ranges) })),
  ]),
)

const covers = (ranges: (readonly [number, number])[], codePoint: number) =>
  ranges.some(([start, end]) => codePoint >= start && codePoint <= end)

/**
 * The font files texts need: per family, each file that has a glyph for at
 * least one of its characters, with those characters. A family's files come
 * most-used first, since a rasterizer takes the first file of a family name;
 * the CJK fallback comes before the families, as Excalidraw orders it. An
 * SVG leaves Helvetica and emoji to the viewer's system fonts.
 */
export function fontFilesFor(
  textsByFamily: Map<number, string>,
  target: FontTarget,
) {
  const wanted = new Map<string, Set<number>>()
  const add = (family: string, codePoints: Iterable<number>) => {
    const set = wanted.get(family) ?? new Set()
    for (const codePoint of codePoints) set.add(codePoint)
    wanted.set(family, set)
  }
  const cjk = new Set<number>()
  for (const [fontFamily, text] of textsByFamily) {
    const family = familyOf(fontFamily, target)
    if (!family) continue
    const chars = [...text]
    add(family.name, chars.map(codePointOf))
    if (!family.handDrawn) continue
    for (const char of chars) if (CJK.test(char)) cjk.add(codePointOf(char))
  }
  const families = [...wanted]
  if (cjk.size) families.unshift([CJK_FALLBACK, cjk])
  return families.flatMap(([family, codePoints]) => {
    const files = (FILES_BY_FAMILY.get(family) ?? [])
      .map(({ file, ranges }) => ({
        family,
        file,
        codePoints: [...codePoints].filter((codePoint) =>
          covers(ranges, codePoint),
        ),
      }))
      .sort((a, b) => b.codePoints.length - a.codePoints.length)
    // A character two files cover goes to the first; unneeded files drop.
    const taken = new Set<number>()
    return files.flatMap((entry) => {
      const own = entry.codePoints.filter((codePoint) => !taken.has(codePoint))
      for (const codePoint of own) taken.add(codePoint)
      return own.length ? [{ ...entry, codePoints: own }] : []
    })
  })
}

/**
 * Excalidraw's font files: the built app serves them from its public assets
 * (vite.config.ts copies them there); dev and tests read the package.
 */
function findFontsDir() {
  const assets = join(process.cwd(), ".output/public/assets")
  if (existsSync(assets)) {
    const dir = readdirSync(assets).find((name) =>
      name.startsWith("excalidraw-"),
    )
    if (dir) return join(assets, dir, "fonts")
  }
  return join(
    process.cwd(),
    "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  )
}

let fontsDir: string | undefined

/** A woff2 file, by its path in {@link FONT_FILES}. */
export function readFontFile(file: string) {
  fontsDir ??= findFontsDir()
  return readFile(join(fontsDir, file))
}

/** The @font-face rules for the texts, each font as a data URL. */
export async function fontFaces(textsByFamily: Map<number, string>) {
  return Promise.all(
    fontFilesFor(textsByFamily, "svg").map(
      async ({ family, file, codePoints }) => {
        const data = (await readFontFile(file)).toString("base64")
        // Each file serves just the characters it was picked for.
        const range = codePoints
          .sort((a, b) => a - b)
          .map((codePoint) => `U+${codePoint.toString(16)}`)
          .join(",")
        return `@font-face { font-family: "${family}"; src: url(data:font/woff2;base64,${data}); unicode-range: ${range}; }`
      },
    ),
  )
}
