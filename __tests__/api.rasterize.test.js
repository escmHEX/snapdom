import { afterEach, expect, it, vi } from 'vitest'
import { rasterize } from '../src/api/rasterize.js'
import { toCanvas } from '../src/exporters/toCanvas.js'

const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="30" fill="#234567"/><rect x="7" y="5" width="11" height="13" fill="#fedcba"/></svg>')
afterEach(() => vi.restoreAllMocks())

it('matches the existing exporter pixels and crop/scale/DPR geometry', async () => {
  for (const options of [{ dpr:1 }, { dpr:1.5, width:80, scale:0.75 }, { dpr:2, crop:{ x:4, y:3, width:20, height:15 } }]) {
    const direct = await toCanvas(url, options)
    const separate = await rasterize(url, { ...options, fast:true })
    try {
      expect([separate.width, separate.height]).toEqual([direct.width, direct.height])
      expect(Array.from(separate.getContext('2d').getImageData(0,0,separate.width,separate.height).data)).toEqual(Array.from(direct.getContext('2d').getImageData(0,0,direct.width,direct.height).data))
    } finally { direct.width=direct.height=separate.width=separate.height=0 }
  }
})

it('propagates an already aborted signal without creating an image', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancel raster'))
  await expect(rasterize(url, { signal:controller.signal })).rejects.toThrow('cancel raster')
})

it('preserves pixels and crop geometry with readback-optimized rasterization', async () => {
  const options = { dpr: 2, crop: { x: 4, y: 3, width: 20, height: 15 }, fast: true }
  const normal = await rasterize(url, options)
  const readback = await rasterize(url, { ...options, willReadFrequently: true })
  try {
    expect([readback.width, readback.height]).toEqual([normal.width, normal.height])
    const pixels = canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
    expect(pixels(readback)).toEqual(pixels(normal))
  } finally { normal.width = normal.height = readback.width = readback.height = 0 }
})

it('releases a completed canvas if abort arrives during native drawing', async () => {
  const controller = new AbortController()
  const original = CanvasRenderingContext2D.prototype.drawImage
  let output
  vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (...args) {
    output = this.canvas
    original.apply(this, args)
    controller.abort(new Error('cancel native raster'))
  })
  await expect(rasterize(url, { signal:controller.signal, fast:true })).rejects.toThrow('cancel native raster')
  expect(output.width).toBe(0)
  expect(output.height).toBe(0)
})

it('propagates invalid image failures', async () => {
  await expect(rasterize('data:image/svg+xml,<svg invalid', { fast:true })).rejects.toThrow()
})
