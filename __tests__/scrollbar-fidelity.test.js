import { afterEach, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { collectScrollbarCSS } from '../src/utils/capture.helpers.js'
import { snapshot, materializeSnapshot, serializeSnapshot, deserializeSnapshot } from '../src/api/snapshot.js'
import { server } from '@vitest/browser/context'
import { getAutomaticThumbMinimum } from '../src/modules/scrollbarMetrics.js'

const cleanup = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

it('shares one native metrics job per capture and propagates cancellation', async () => {
  const capture = new WeakMap()
  const first = getAutomaticThumbMinimum(capture, {})
  expect(getAutomaticThumbMinimum(capture, {})).toBe(first)
  await first
  const controller = new AbortController()
  controller.abort(new DOMException('test cancellation', 'AbortError'))
  await expect(getAutomaticThumbMinimum(new WeakMap(), { signal:controller.signal })).rejects.toThrow('test cancellation')
  await expect(getAutomaticThumbMinimum(new WeakMap(), {})).resolves.toEqual(await first)
})

function fixture() {
  const css = document.createElement('style')
  css.textContent = `:root { --test-thumb: rgb(30, 180, 70); }
    @supports selector(::-webkit-scrollbar-thumb) {
      .scroll-fixture::-webkit-scrollbar { width: 8px; height: 8px; }
      .scroll-fixture::-webkit-scrollbar-thumb { background: var(--test-thumb); border-radius: 4px; }
      .scroll-fixture::-webkit-scrollbar-track { background: rgb(20, 30, 40); }
      .scroll-fixture::-webkit-scrollbar-button { display: none; }
    }`
  document.head.append(css); cleanup.push(() => css.remove())
  const root = document.createElement('div')
  root.className = 'scroll-fixture'
  root.style.cssText = 'width:200px;height:100px;overflow:auto;background:rgb(20,30,40)'
  root.innerHTML = '<div style="height:400px;background:rgb(80,90,100)"></div>'
  const frame = document.createElement('div')
  frame.dataset.scrollbarFixture = ''
  frame.style.cssText = 'width:200px;height:100px'
  frame.append(root)
  document.body.append(frame); cleanup.push(() => frame.remove())
  return frame
}

it('retains supported nested scrollbar declarations', () => {
  fixture()
  expect(collectScrollbarCSS(document)).toContain('@supports selector(::-webkit-scrollbar-thumb)')
})

it.each(['vertical', 'horizontal'])('matches the native minimum thumb for a very long %s scroller', async axis => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const runnerStyle = await server.commands.normalizeScrollbarFrame()
  cleanup.push(() => server.commands.restoreScrollbarFrame(runnerStyle))
  const root = fixture()
  const vertical = axis === 'vertical'
  root.firstChild.firstChild.style.height = vertical ? '100000px' : '1px'
  root.firstChild.firstChild.style.width = vertical ? '1px' : '100000px'
  root.firstChild[vertical ? 'scrollTop' : 'scrollLeft'] = 45000
  const image = new Image()
  image.src = `data:image/png;base64,${await server.commands.nativeScrollbarImage()}`
  await image.decode()
  const native = document.createElement('canvas')
  native.width = image.width; native.height = image.height
  native.getContext('2d').drawImage(image, 0, 0)
  const captured = await snapdom.toCanvas(root, { scale: 1, embedFonts: false })
  const thumbRows = canvas => {
    const pixels = vertical ? canvas.getContext('2d').getImageData(196, 0, 1, 100).data :
      canvas.getContext('2d').getImageData(0, 96, 200, 1).data
    const rows = []
    // Compare painted bounds at half coverage, excluding differences in edge
    // antialiasing between native scrollbar parts and the SVG image renderer.
    for (let y = 0; y < pixels.length / 4; y++) if (pixels[y * 4 + 1] > 105) rows.push(y)
    return rows
  }
  expect(image.width).toBe(200)
  expect(thumbRows(native).length).toBeGreaterThan(0)
  expect(thumbRows(captured)).toEqual(thumbRows(native))
})

it('paints the authored scrollbar width and inherited color in the exported pixels', async () => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const root = fixture()
  const canvas = await snapdom.toCanvas(root, { scale: 1, embedFonts: false })
  const ctx = canvas.getContext('2d')
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
  expect(pixel(196, 10)).toEqual([30, 180, 70])
  expect(pixel(196, 70)).toEqual([20, 30, 40])
  expect(pixel(190, 95)).toEqual([80, 90, 100])
})

it('retains the thumb position and clipping after scrolling without mutating the source', async () => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const root = fixture()
  root.firstChild.scrollTop = 120
  const original = root.outerHTML
  const canvas = await snapdom.toCanvas(root, { scale: 1, embedFonts: false })
  const ctx = canvas.getContext('2d')
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
  expect(pixel(196, 10)).toEqual([20, 30, 40])
  expect(pixel(196, 40)).toEqual([30, 180, 70])
  expect(pixel(196, 80)).toEqual([20, 30, 40])
  expect(pixel(190, 95)).toEqual([80, 90, 100])
  expect(root.outerHTML).toBe(original)
  expect(root.firstChild.scrollTop).toBe(120)
})

it('preserves both axes and the native corner after portable snapshot materialization', async () => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const root = fixture()
  root.firstChild.firstChild.style.width = '400px'
  root.firstChild.scrollTop = 120
  root.firstChild.scrollLeft = 80
  const frozen = snapshot(root); cleanup.push(() => frozen.dispose())
  const packet = await serializeSnapshot(frozen); cleanup.push(() => packet.dispose())
  const received = await deserializeSnapshot(structuredClone(packet.payload)); cleanup.push(() => received.dispose())
  root.firstChild.scrollTop = 0
  root.firstChild.scrollLeft = 0
  const materialized = await materializeSnapshot(received); cleanup.push(() => materialized.dispose())
  const canvas = await snapdom.toCanvas(materialized.element, { scale: 1, embedFonts: false })
  const ctx = canvas.getContext('2d')
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)
  expect(pixel(196, 35)).toEqual([30, 180, 70])
  expect(pixel(60, 96)).toEqual([30, 180, 70])
  expect(pixel(180, 96)).toEqual([20, 30, 40])
  expect(pixel(196, 96)).toEqual([255, 255, 255])
})

it.each(['border-box', 'content-box'])('does not change the %s scroller dimensions', async boxSizing => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const root = fixture()
  root.firstChild.style.boxSizing = boxSizing
  const canvas = await snapdom.toCanvas(root, { scale: 1, embedFonts: false })
  const data = canvas.getContext('2d').getImageData(196, 10, 1, 1).data
  expect([...data]).toEqual([30, 180, 70, 255])
})

it('keeps a left-side scrollbar and its scrolled content in RTL', async () => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const root = fixture()
  root.firstChild.style.direction = 'rtl'
  root.firstChild.scrollTop = 120
  const canvas = await snapdom.toCanvas(root, { scale: 1, embedFonts: false })
  const ctx = canvas.getContext('2d')
  expect([...ctx.getImageData(4, 40, 1, 1).data]).toEqual([30, 180, 70, 255])
  expect([...ctx.getImageData(196, 40, 1, 1).data]).toEqual([80, 90, 100, 255])
})

it('places the thumb for negative column-reverse scrolling', async () => {
  if (!CSS.supports('selector(::-webkit-scrollbar-thumb)')) return
  const root = fixture()
  root.firstChild.style.display = 'flex'
  root.firstChild.style.flexDirection = 'column-reverse'
  root.firstChild.firstChild.style.flexShrink = '0'
  root.firstChild.scrollTop = -120
  const canvas = await snapdom.toCanvas(root, { scale: 1, embedFonts: false })
  const ctx = canvas.getContext('2d')
  expect([...ctx.getImageData(196, 50, 1, 1).data]).toEqual([30, 180, 70, 255])
  expect([...ctx.getImageData(196, 10, 1, 1).data]).toEqual([20, 30, 40, 255])
})
