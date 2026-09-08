import { afterEach, expect, it, vi } from 'vitest'
import { iconToImage } from '../src/modules/fonts.js'
import { materialIconToImage } from '../src/modules/iconFonts.js'
import { canvasToDataURL } from '../src/utils/blob.js'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

it('preserves icon coverage and dimensions when using CPU backing for immediate PNG readback', async () => {
  const nativeContext = HTMLCanvasElement.prototype.getContext
  for (const render of [
    () => iconToImage('X', 'serif', 700, 24, '#123456', { dpr: 2 }),
    () => materialIconToImage('X', { family: 'serif', weight: 700, fontSize: 24, color: '#123456', dpr: 2 })
  ]) {
    const gpu = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (type, options) {
      return nativeContext.call(this, type, type === '2d' ? { ...options, willReadFrequently: false } : options)
    })
    const baseline = await render()
    gpu.mockRestore()
    const current = await render()
    expect([current.width, current.height]).toEqual([baseline.width, baseline.height])
    const coverage = []
    for (const result of [baseline, current]) {
      const image = new Image()
      image.src = result.dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      // RGB rounding at low-alpha edges differs between GPU and CPU readback;
      // exact alpha preserves the glyph shape, coverage, and placement.
      coverage.push(Array.from(pixels).filter((_, index) => index % 4 === 3))
      canvas.width = canvas.height = 0
    }
    expect(coverage[1]).toEqual(coverage[0])
  }
})
it('measures and rasterizes icons in the supplied frozen document at its capture DPR', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument
  const originalWrites = []
  const observer = new MutationObserver(records => originalWrites.push(...records))
  observer.observe(document.body, { childList: true, subtree: true, attributes: true })
  const localCreate = doc.createElement.bind(doc)
  const canvases = []
  vi.spyOn(doc, 'createElement').mockImplementation((tag, options) => {
    const node = localCreate(tag, options)
    if (tag === 'canvas') canvases.push(node)
    return node
  })
  try {
    const result = await iconToImage('X', 'serif', 700, 20, '#123456', { document: doc, dpr: 2 })
    const image = new Image()
    image.src = result.dataUrl
    await image.decode()
    expect(image.naturalWidth).toBe(result.width * 2)
    expect(image.naturalHeight).toBe(result.height * 2)
    expect(canvases).toHaveLength(1)
    expect(canvases[0].width).toBe(0)
    expect(doc.querySelector('[data-snapdom-internal]')).toBeNull()
    await Promise.resolve()
    expect(originalWrites).toHaveLength(0)
  } finally { observer.disconnect() }
})
it('releases the isolated measurement and canvas when icon encoding fails', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument
  const localCreate = doc.createElement.bind(doc)
  let canvas
  vi.spyOn(doc, 'createElement').mockImplementation((tag, options) => {
    const node = localCreate(tag, options)
    if (tag === 'canvas') {
      canvas = node
      node.toBlob = () => { throw new Error('icon encode failed') }
    }
    return node
  })
  await expect(iconToImage('X', 'serif', 700, 20, '#000', { document: doc, dpr: 1 })).rejects.toThrow('icon encode failed')
  expect(canvas.width).toBe(0)
  expect(doc.querySelector('[data-snapdom-internal]')).toBeNull()
})

it('keeps the icon buffer until the asynchronous encoder finishes', async () => {
  const nativeEncode = HTMLCanvasElement.prototype.toBlob
  let resume
  let canvas
  const entered = new Promise(resolve => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (...args) {
      canvas = this
      resume = () => nativeEncode.apply(this, args)
      resolve()
    })
  })
  const result = iconToImage('X', 'serif', 700, 20)
  await entered
  expect(canvas.width).toBeGreaterThan(0)
  expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
  resume()
  expect((await result).dataUrl).toMatch(/^data:image\/png;base64,/)
  expect([canvas.width, canvas.height]).toEqual([0, 0])
})

it('preserves decoded pixels when replacing synchronous PNG encoding', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 51
  canvas.height = 37
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#12345680'
  ctx.fillRect(2, 3, 30, 21)
  ctx.font = '19px serif'
  ctx.fillText('X', 9, 28)
  const urls = [canvas.toDataURL(), await canvasToDataURL(canvas)]
  const pixels = []
  for (const url of urls) {
    const image = new Image()
    image.src = url
    await image.decode()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    pixels.push(Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data))
  }
  expect(pixels[1]).toEqual(pixels[0])
  canvas.width = canvas.height = 0
})

it('rejects an empty asynchronous encoding result', async () => {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(null))
  await expect(canvasToDataURL(canvas)).rejects.toThrow('Canvas encoding failed')
})
