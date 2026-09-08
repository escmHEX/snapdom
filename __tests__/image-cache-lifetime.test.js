import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inlineImages } from '../src/modules/images.js'
import { snapFetch } from '../src/modules/snapFetch.js'
import { preCache } from '../src/api/preCache.js'
import { cache } from '../src/core/cache.js'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="red"/></svg>'
const dataURL = `data:image/svg+xml,${encodeURIComponent(svg)}`
const urls = []
function objectURL() {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  urls.push(url)
  return url
}
function imageRoot(src) {
  const root = document.createElement('div'), image = document.createElement('img')
  image.width = 4; image.height = 3; image.src = src; root.appendChild(image)
  return root
}
beforeEach(() => cache.image.clear())
afterEach(() => { vi.restoreAllMocks(); cache.image.clear(); for (const url of urls.splice(0)) URL.revokeObjectURL(url) })

describe('image cache lifetime', () => {
  it('does not retain twenty pairs of operation-specific image URLs', async () => {
    for (let operation = 0; operation < 20; operation++) {
      for (let image = 0; image < 2; image++) {
        const url = objectURL(), root = imageRoot(url)
        await inlineImages(root)
        expect(root.firstElementChild.src.startsWith('data:image/svg+xml')).toBe(true)
        URL.revokeObjectURL(url)
      }
      expect(cache.image.size).toBe(0)
    }
  })

  it('does not serve a previously inlined resource after its object URL is revoked', async () => {
    const url = objectURL(), first = imageRoot(url)
    await inlineImages(first)
    URL.revokeObjectURL(url)
    const second = imageRoot(url)
    await inlineImages(second, { placeholders: false })
    expect(second.querySelector('img')).toBeNull()
    expect(second.firstElementChild.style.visibility).toBe('hidden')
    expect(cache.image.has(url)).toBe(false)
  })

  it('keeps data URLs and ephemeral preCache resources out of the global cache', async () => {
    const root = imageRoot(dataURL)
    root.appendChild(imageRoot(objectURL()).firstElementChild)
    await preCache(root, { embedFonts: false, cache: 'soft' })
    expect(cache.image.size).toBe(0)
    await inlineImages(root)
    expect(cache.image.size).toBe(0)
    expect(root.querySelectorAll('img')).toHaveLength(2)
  })

  it('reuses successful normal URL data across separate captures', async () => {
    const url = new URL('/snapshot-cache-lifetime.svg', location.href).href
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }))
    const first = imageRoot(url), second = imageRoot(url)
    await inlineImages(first); await inlineImages(second)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cache.image.get(url)).toBe(first.firstElementChild.src)
    expect(second.firstElementChild.src).toBe(first.firstElementChild.src)
  })

  it('snapFetch does not memoize either a successful blob read or later revocation', async () => {
    const url = objectURL()
    expect((await snapFetch(url, { as: 'dataURL' })).ok).toBe(true)
    URL.revokeObjectURL(url)
    const firstFailure = await snapFetch(url, { as: 'dataURL' })
    const secondFailure = await snapFetch(url, { as: 'dataURL' })
    expect(firstFailure.ok).toBe(false); expect(firstFailure.fromCache).toBe(false)
    expect(secondFailure.ok).toBe(false); expect(secondFailure.fromCache).toBe(false)
  })
})
