import { afterEach, expect, it, vi } from 'vitest'
import { toCanvas } from '../src/exporters/toCanvas.js'
import { TRANSPARENT_PNG } from '../src/utils/image.constants.js'

const images = []
const NativeImage = globalThis.Image
const options = { width: 20, height: 12, scale: 1, dpr: 1, meta: {} }
function trackImages() {
  globalThis.Image = function (...args) {
    const image = new NativeImage(...args)
    images.push(image)
    return image
  }
}
afterEach(() => { globalThis.Image = NativeImage; images.length = 0; vi.restoreAllMocks() })
const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><rect width="20" height="12" fill="red"/></svg>')
it('releases its decoded image while preserving the returned canvas pixels', async () => {
  trackImages()
  const canvas = await toCanvas(svg, options)
  try {
    expect(images.at(-1).src).toBe(TRANSPARENT_PNG)
    const released = document.createElement('canvas')
    released.width = released.height = 1
    released.getContext('2d').drawImage(images.at(-1), 0, 0, 1, 1)
    expect(released.getContext('2d').getImageData(0, 0, 1, 1).data[3]).toBe(0)
    released.width = released.height = 0
    expect(Array.from(canvas.getContext('2d').getImageData(5, 5, 1, 1).data)).toEqual([255, 0, 0, 255])
  } finally { canvas.width = canvas.height = 0 }
})
it('releases the image after a decode error', async () => {
  trackImages()
  await expect(toCanvas('data:image/png;base64,invalid', options)).rejects.toThrow()
  expect(images.at(-1).src).toBe(TRANSPARENT_PNG)
})
it('does not wait for decoding the never-drawn replacement image', async () => {
  const decode = HTMLImageElement.prototype.decode
  let replacementDecodeCalls = 0
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function () {
    if (this.src === TRANSPARENT_PNG) {
      replacementDecodeCalls++
      return new Promise(() => {})
    }
    return decode.call(this)
  })
  const canvas = await toCanvas(svg, options)
  try {
    expect(replacementDecodeCalls).toBe(0)
    expect(Array.from(canvas.getContext('2d').getImageData(5, 5, 1, 1).data)).toEqual([255, 0, 0, 255])
  } finally { canvas.width = canvas.height = 0 }
})
it('preserves the original error if image cleanup also fails', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function () {
    return Promise.reject(new Error(this.src === TRANSPARENT_PNG ? 'cleanup failure' : 'original decode failure'))
  })
  await expect(toCanvas('data:image/png;base64,invalid', options)).rejects.toThrow('original decode failure')
})
it('releases failed output allocation and image after a draw error', async () => {
  trackImages()
  const draw = CanvasRenderingContext2D.prototype.drawImage
  let failedCanvas
  vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (...args) {
    if (this.canvas.width === 20 && this.canvas.height === 12) {
      failedCanvas = this.canvas
      throw new Error('intentional draw error')
    }
    return draw.apply(this, args)
  })
  await expect(toCanvas(svg, options)).rejects.toThrow('intentional draw error')
  expect(failedCanvas.width).toBe(0)
  expect(failedCanvas.height).toBe(0)
  expect(images.at(-1).src).toBe(TRANSPARENT_PNG)
})
it('cancels a pending decode but waits for neutral-image cleanup before rejecting', async () => {
  trackImages()
  const originalDecode = HTMLImageElement.prototype.decode
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function () {
    if (this.src === TRANSPARENT_PNG) return new Promise(() => {})
    return originalDecode.call(this)
  })
  const controller = new AbortController()
  let settled = false
  const work = toCanvas(TRANSPARENT_PNG, { ...options, signal: controller.signal }).finally(() => { settled = true })
  const rejection = expect(work).rejects.toThrow('cancel pending decode')
  const img = images.at(-1), add = img.addEventListener.bind(img)
  let completeCleanup, notifyLoaded
  const loaded = new Promise(resolve => { notifyLoaded = resolve })
  vi.spyOn(img, 'addEventListener').mockImplementation((type, listener, settings) => {
    if (type !== 'load') return add(type, listener, settings)
    add(type, event => { completeCleanup = () => listener(event); notifyLoaded() }, { once: true })
  })
  controller.abort(new Error('cancel pending decode'))
  await loaded
  expect(settled).toBe(false)
  expect(img.currentSrc).toBe(TRANSPARENT_PNG)
  completeCleanup()
  await rejection
  expect(settled).toBe(true)
})
