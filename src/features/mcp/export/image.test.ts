// @vitest-environment node
// (wawoff2 rejects jsdom's typed arrays.)
import { expect, test } from "vitest"
import { exportImage } from "./image"

const label = {
  id: "label",
  type: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 25,
  text: "Hello 漢字",
  fontSize: 20,
  fontFamily: 5,
}
const options = {
  darkMode: false,
  background: true,
  backgroundColor: "#ffffff",
  padding: 10,
  scale: 2,
}

test("renders a PNG at the scaled size", async () => {
  const image = await exportImage([label], new Map(), {
    ...options,
    format: "png",
  })
  const png = image?.data ?? Buffer.alloc(0)
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  // IHDR holds the pixel size: (120 + 2 × 10) × 2 by (25 + 2 × 10) × 2.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([280, 90])
  expect(image).toMatchObject({ width: 280, height: 90 })
})

test("refuses a PNG over 4096 × 4096 pixels", async () => {
  await expect(
    exportImage([{ ...label, width: 3000, height: 3000 }], new Map(), {
      ...options,
      format: "png",
    }),
  ).rejects.toThrow("Use a smaller scale, or SVG")
})
