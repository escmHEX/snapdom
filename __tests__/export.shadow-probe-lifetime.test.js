import { afterEach, expect, it, vi } from 'vitest'
import { fixSafariShadows } from '../src/exporters/toCanvas.js'

afterEach(() => vi.restoreAllMocks())

it('retains only the shadow capability result, releasing probe pixels and SVG image', async () => {
  const canvases = [], images = []
  const NativeImage = globalThis.Image
  const context = HTMLCanvasElement.prototype.getContext
  vi.spyOn(globalThis, 'Image').mockImplementation(function () {
    const image = new NativeImage()
    images.push(image)
    return image
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (...args) {
    if (this.width === 8 && this.height === 20) canvases.push(this)
    return context.apply(this, args)
  })
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>.box{box-shadow:0px 8px 0px #000}</style></svg>'
  await fixSafariShadows(svg)
  expect(canvases).toHaveLength(1)
  expect([canvases[0].width, canvases[0].height]).toEqual([0, 0])
  expect(images).toHaveLength(1)
  expect(images[0].currentSrc).toMatch(/^data:image\/png/)
  await fixSafariShadows(svg)
  expect(canvases).toHaveLength(1)
  expect(images).toHaveLength(1)
})
