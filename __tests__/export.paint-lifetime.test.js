import { afterEach, expect, it, vi } from 'vitest'
import { toCanvas } from '../src/exporters/toCanvas.js'
import { isSafari } from '../src/utils/browser.js'

afterEach(() => vi.restoreAllMocks())
const blank = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"/>')
const options = { width: 20, height: 12, scale: 1, dpr: 1, meta: {} }

function trackPaintWork() {
  const frames = new Set(), timers = new Set(), probes = new Set()
  const raf = window.requestAnimationFrame.bind(window), cancelRaf = window.cancelAnimationFrame.bind(window)
  const timeout = window.setTimeout.bind(window), cancelTimeout = window.clearTimeout.bind(window)
  const context = HTMLCanvasElement.prototype.getContext
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = raf(time => { frames.delete(id); callback(time) }); frames.add(id); return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); cancelRaf(id) })
  vi.spyOn(window, 'setTimeout').mockImplementation((callback, ms, ...args) => {
    if (ms !== 50) return timeout(callback, ms, ...args)
    const id = timeout(() => { timers.delete(id); callback(...args) }, ms); timers.add(id); return id
  })
  vi.spyOn(window, 'clearTimeout').mockImplementation(id => { timers.delete(id); cancelTimeout(id) })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (...args) {
    if (this.width === 16 && this.height === 16) probes.add(this)
    return context.apply(this, args)
  })
  return { frames, timers, probes }
}

function expectReleased(work) {
  expect(work.probes.size).toBeGreaterThan(0)
  for (const probe of work.probes) expect([probe.width, probe.height]).toEqual([0, 0])
  expect(work.frames.size).toBe(0)
  expect(work.timers.size).toBe(0)
  expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
}

it.runIf(isSafari())('releases native paint-probe canvases and losing timers after a blank export', async () => {
  const work = trackPaintWork()
  const canvas = await toCanvas(blank, options)
  try { expectReleased(work) } finally { canvas.width = canvas.height = 0 }
})

it.runIf(isSafari())('releases native paint work after failure following a frame yield', async () => {
  const work = trackPaintWork(), read = CanvasRenderingContext2D.prototype.getImageData
  let probes = 0
  vi.spyOn(CanvasRenderingContext2D.prototype, 'getImageData').mockImplementation(function (...args) {
    if (this.canvas.width === 16 && this.canvas.height === 16 && ++probes === 2) throw new Error('paint probe failure')
    return read.apply(this, args)
  })
  await expect(toCanvas(blank, options)).rejects.toThrow('paint probe failure')
  expectReleased(work)
})
