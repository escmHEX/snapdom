import { describe, it, expect } from 'vitest'
import { snapdom } from '../src/index.js'

const options = { embedFonts: false, outerTransforms: false, outerShadows: false }

function svgRoot(result) {
  return new DOMParser().parseFromString(decodeURIComponent(result.url.split(',')[1]), 'image/svg+xml').documentElement
}

describe('root raster padding', () => {
  for (const transform of ['none', 'matrix(1,0,0,1,0,0)']) {
    it(`preserves exact dimensions and edge pixels for ${transform}`, async () => {
      const root = document.createElement('div')
      root.style.cssText = `width:80px;height:40px;background:rgb(255,0,0);transform:${transform};`
      document.body.append(root)
      let canvas
      try {
        const result = await snapdom(root, options)
        const svg = svgRoot(result)
        expect(svg.getAttribute('width')).toBe('80')
        expect(svg.getAttribute('height')).toBe('40')
        expect(svg.getAttribute('viewBox')).toBe('0 0 80 40')
        canvas = await result.toCanvas({ width: 80, height: 40, dpr: 1 })
        const pixels = canvas.getContext('2d').getImageData(0, 0, 80, 40).data
        for (const [x, y] of [[0, 0], [79, 0], [0, 39], [79, 39], [40, 20]]) {
          expect(Array.from(pixels.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 4))).toEqual([255, 0, 0, 255])
        }
      } finally {
        root.remove()
        if (canvas) canvas.width = canvas.height = 0
      }
    })
  }

  it('keeps padding for normalized scaled roots', async () => {
    const root = document.createElement('div')
    root.style.cssText = 'width:80px;height:40px;background:rgb(0,128,0);transform:scale(1.25);'
    document.body.append(root)
    try {
      const rect = root.getBoundingClientRect()
      const svg = svgRoot(await snapdom(root, options))
      // The transformed bbox retains three pixels on each side against clipping.
      expect(Number(svg.getAttribute('width'))).toBe(Math.ceil(rect.width + 6))
      expect(Number(svg.getAttribute('height'))).toBe(Math.ceil(rect.height + 6))
    } finally { root.remove() }
  })
})
