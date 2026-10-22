import { afterEach, describe, expect, it } from 'vitest'
import { inlineImages } from '../src/modules/images.js'

let url
afterEach(() => { if (url) URL.revokeObjectURL(url) })

describe('image input resources', () => {
  it('keeps image input sizing when a fallback resource is used', async () => {
    url = URL.createObjectURL(new Blob(['unavailable']))
    URL.revokeObjectURL(url)
    const input = document.createElement('input')
    input.type = 'image'
    input.src = url
    input.style.cssText = 'width:24px;height:auto'
    await inlineImages(input, {
      fallbackURL: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="12"/%3E',
    })
    expect(input.src).toMatch(/^data:image\/svg\+xml/)
    expect(input.hasAttribute('width')).toBe(false)
    expect(input.hasAttribute('height')).toBe(false)
  })

  for (const root of [true, false]) {
    it(`embeds an image input ${root ? 'root' : 'descendant'} without changing its geometry`, async () => {
      url = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>'], { type: 'image/svg+xml' }))
      const input = document.createElement('input')
      input.type = 'image'
      input.src = url
      input.style.cssText = 'width:24px;height:24px'
      const host = root ? input : document.createElement('div')
      if (!root) host.append(input)
      await inlineImages(host)
      expect(input.src).toMatch(/^data:image\/svg\+xml/)
      expect(input.style.width).toBe('24px')
      expect(input.style.height).toBe('24px')
      expect(input.hasAttribute('width')).toBe(false)
      expect(input.hasAttribute('height')).toBe(false)
    })
  }
})
