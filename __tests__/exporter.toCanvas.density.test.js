import { describe, expect, it } from 'vitest'
import { toCanvas, fixSafariShadows, encodeSvgToDataURL } from '../src/exporters/toCanvas.js'
import { isSafari } from '../src/utils/browser.js'

const content = '<foreignObject x="0" y="0" width="80" height="40"><div xmlns="http://www.w3.org/1999/xhtml" data-snapdom-wrapper="" style="width:80px;height:40px"><div style="width:80px;height:40px;background:white;font:16px sans-serif;text-shadow:1px 1px 1px red;color:black">Sharp<div style="height:12px;width:70px;margin:2px;box-shadow:1px 1px 1px blue;background:repeating-linear-gradient(90deg,black 0px,black 1px,white 1px,white 2px)"></div></div></div></foreignObject>'
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40">${content}</svg>`

async function reference(width, height, viewBox) {
  const box = viewBox.split(' ').map(Number)
  const density = isSafari() ? Math.ceil(width / box[2]) : width / box[2]
  const rasterWidth = isSafari() ? box[2] * density : width
  const rasterHeight = isSafari() ? box[3] * density : height
  // Independent physical-size fixture: scale its CSS lengths directly, without
  // either SVG viewBox scaling or the exporter's wrapper zoom implementation.
  const physicalContent = content.replace(/([\d.]+)px/g, (_, value) => `${Number(value) * density}px`)
    .replace('width="80" height="40"', `width="${80 * density}" height="${40 * density}"`)
  let text = `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterWidth}" height="${rasterHeight}" viewBox="${box.map(value => value * density).join(' ')}">${physicalContent}</svg>`
  // Other engines retain their existing SVG scaling path unchanged.
  if (!isSafari()) text = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${content}</svg>`
  if (isSafari()) text = (await fixSafariShadows(text)).svg
  const image = new Image()
  try {
    image.src = encodeSvgToDataURL(text)
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const physical = document.createElement('canvas')
    try {
      physical.width = rasterWidth
      physical.height = rasterHeight
      physical.getContext('2d').drawImage(image, 0, 0)
      canvas.getContext('2d').drawImage(physical, 0, 0, width, height)
    } finally { physical.width = physical.height = 0 }
    return canvas
  } finally { image.removeAttribute('src') }
}

async function assertRaster(options, width, height, viewBox = '0 0 80 40') {
  const actual = await toCanvas(encodeSvgToDataURL(svg), options)
  const expected = await reference(width, height, viewBox)
  try {
    expect([actual.width, actual.height]).toEqual([width, height])
    const a = actual.getContext('2d').getImageData(0, 0, width, height).data
    const b = expected.getContext('2d').getImageData(0, 0, width, height).data
    let changedChannels = 0, maxDelta = 0
    for (let i = 0; i < a.length; i++) {
      const delta = Math.abs(a[i] - b[i])
      if (delta) changedChannels++
      maxDelta = Math.max(maxDelta, delta)
    }
    expect({ changedChannels, maxDelta }).toEqual({ changedChannels: 0, maxDelta: 0 })
  } finally { actual.width = actual.height = expected.width = expected.height = 0 }
}

describe('shadow-safe native SVG raster density', () => {
  for (const position of ['fixed', 'absolute', 'relative']) {
    it(`keeps ${position} descendants at their logical viewport coordinates`, async () => {
      const fixedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40"><foreignObject width="80" height="40"><div xmlns="http://www.w3.org/1999/xhtml" data-snapdom-wrapper="" style="width:80px;height:40px;position:relative;text-shadow:1px 1px 1px red"><div style="position:${position};left:60px;top:20px;width:10px;height:10px;background:rgb(0,128,0)"></div></div></foreignObject></svg>`
      const canvas = await toCanvas(encodeSvgToDataURL(fixedSvg), { width: 80, height: 40, dpr: 2 })
      try {
        expect(Array.from(canvas.getContext('2d').getImageData(130, 50, 1, 1).data)).toEqual([0, 128, 0, 255])
        expect(Array.from(canvas.getContext('2d').getImageData(65, 25, 1, 1).data)).toEqual([0, 0, 0, 0])
      } finally { canvas.width = canvas.height = 0 }
    })
  }

  it('preserves an existing raster wrapper transform', async () => {
    const transformed = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40"><foreignObject width="80" height="40"><div xmlns="http://www.w3.org/1999/xhtml" data-snapdom-wrapper="" style="width:80px;height:40px;transform:translateX(5px);text-shadow:1px 1px 1px red"><div style="position:fixed;left:60px;top:20px;width:10px;height:10px;background:rgb(0,128,0)"></div></div></foreignObject></svg>'
    const canvas = await toCanvas(encodeSvgToDataURL(transformed), { width: 80, height: 40, dpr: 2 })
    try {
      const ctx = canvas.getContext('2d')
      expect(Array.from(ctx.getImageData(145, 50, 1, 1).data)).toEqual([0, 128, 0, 255])
      expect(Array.from(ctx.getImageData(125, 50, 1, 1).data)).toEqual([0, 0, 0, 0])
    } finally { canvas.width = canvas.height = 0 }
  })
  it('preserves raw foreignObject direct selectors and the previous raster behavior', async () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" width="80px" height="40px" viewBox="0 0 80 40"><style>foreignObject > .target{background:currentColor}</style><foreignObject width="80px" height="40px" style="color:rgb(0,128,0)"><div xmlns="http://www.w3.org/1999/xhtml" class="target" style="width:20px;height:20px;text-shadow:1px 1px 1px red">x</div></foreignObject></svg>'
    const actual = await toCanvas(encodeSvgToDataURL(raw), { width: 80, height: 40, dpr: 2 })
    const image = new Image()
    const native = document.createElement('canvas')
    const expected = document.createElement('canvas')
    try {
      image.src = encodeSvgToDataURL(isSafari() ? (await fixSafariShadows(raw)).svg : raw)
      await image.decode()
      native.width = 80; native.height = 40
      expected.width = 160; expected.height = 80
      const ctx = expected.getContext('2d')
      if (isSafari()) {
        native.getContext('2d').drawImage(image, 0, 0)
        ctx.drawImage(native, 0, 0, 160, 80)
      } else ctx.drawImage(image, 0, 0, 160, 80)
      const a = actual.getContext('2d').getImageData(0, 0, 160, 80).data
      const b = ctx.getImageData(0, 0, 160, 80).data
      expect(a.every((value, index) => value === b[index])).toBe(true)
      expect(Array.from(actual.getContext('2d').getImageData(30, 30, 1, 1).data)).toEqual([0, 128, 0, 255])
    } finally {
      image.removeAttribute('src')
      actual.width = actual.height = native.width = native.height = expected.width = expected.height = 0
    }
  })
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    it(`renders text and shadow pixels at DPR ${dpr}`, async () => {
      await assertRaster({ width: 80, height: 40, dpr }, 80 * dpr, 40 * dpr)
    })
  }
  it('keeps natural logical size when only density increases', async () => {
    await assertRaster({ dpr: 2 }, 160, 80)
  })
  it('uses the cropped aspect instead of full-capture metadata at fractional DPR', async () => {
    await assertRaster({ crop: { x: 20, y: 10, width: 40, height: 20 }, width: 80, dpr: 1.25, meta: { vbW: 80, vbH: 80 } }, 100, 50, '20 10 40 20')
  })
  it('combines scale and density without scaling the logical crop twice', async () => {
    await assertRaster({ crop: { x: 0, y: 0, width: 40, height: 20 }, height: 20, scale: 1.25, dpr: 2 }, 100, 50, '0 0 40 20')
  })
})
