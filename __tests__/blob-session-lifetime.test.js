import { afterEach, expect, it, vi } from 'vitest'
import { blobUrlToDataUrl, resolveBlobUrlsInTree } from '../src/utils/clone.helpers.js'
import { inlineSingleBackgroundEntry } from '../src/utils/image.js'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'

const urls = []
function blob(type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], { type }))
  urls.push(url)
  return url
}
afterEach(() => {
  for (const url of urls.splice(0)) URL.revokeObjectURL(url)
  cache.resource.clear(); cache.background.clear(); cache.font.clear()
  vi.restoreAllMocks()
})
it('deduplicates blob reads inside one clone pass without persisting unique capture bytes', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  for (let i = 0; i < 12; i++) {
    const url = blob()
    const root = document.createElement('div')
    root.innerHTML = `<img src="${url}"><img src="${url}">`
    await resolveBlobUrlsInTree(root)
    expect(root.firstElementChild.src).toBe(root.lastElementChild.src)
    expect(root.firstElementChild.src).toContain('data:image/svg+xml')
    expect(cache.resource.has(url)).toBe(false)
  }
  expect(fetch).toHaveBeenCalledTimes(12)
})
it('a new call cannot return previously read bytes after revocation', async () => {
  const url = blob()
  await blobUrlToDataUrl(url)
  URL.revokeObjectURL(url)
  await expect(blobUrlToDataUrl(url)).rejects.toThrow('Failed to read blob URL')
})
it('background and font conversion do not persist blob keys or seen-font entries', async () => {
  const image = blob()
  expect(await inlineSingleBackgroundEntry(`url("${image}")`)).toContain('data:image/svg+xml')
  expect(cache.background.size).toBe(0)
  const font = blob('font/woff2')
  const css = await embedCustomFonts({
    doc: document.implementation.createHTMLDocument(''),
    required: new Set(['SnapshotFace__400__normal__100']),
    usedCodepoints: new Set([65]),
    localFonts: [{ family: 'SnapshotFace', src: font }]
  })
  expect(css).toContain('data:font/woff2')
  expect(cache.resource.has(font)).toBe(false)
  expect(cache.font.has(font)).toBe(false)
})
