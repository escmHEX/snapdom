import { afterEach, expect, it, vi } from 'vitest'
import { snapdom } from '../src/index.js'
import { inlineImages } from '../src/modules/images.js'

const cleanup = []
afterEach(() => { vi.restoreAllMocks(); for (const dispose of cleanup.splice(0).reverse()) dispose() })
async function fixture(css = '') {
  const root = document.createElement('div')
  root.style.cssText = 'width:393.75px;background:white;color:black;font:17px Arial;border:1px solid black;'
  root.innerHTML = '<span>Before baseline</span><img id="hidden-intrinsic" class="original-image" data-label="preserve"><span>After baseline</span>'
  const source = root.querySelector('img')
  source.style.cssText = `visibility:hidden;${css}`
  const canvas = document.createElement('canvas'); canvas.width = 211; canvas.height = 97
  canvas.getContext('2d').fillRect(0, 0, 211, 97)
  source.src = canvas.toDataURL(); canvas.width = canvas.height = 0
  document.body.append(root); cleanup.push(() => root.remove())
  await source.decode()
  return { root, source }
}
const options = { cache: 'soft', embedFonts: false, compress: false, fast: true, dpr: 2, scale: 1, outerShadows: false }

for (const [name, imageCss, rootCss] of [
  ['inline baseline', '', ''],
  ['height only', 'height:63.25px;width:auto', ''],
  ['max width', 'max-width:121.5px;height:auto', ''],
  ['fractional percentage', 'width:35%;height:auto', ''],
  ['flex baseline', 'flex:0 1 auto', 'display:flex;align-items:baseline;width:293.75px'],
  ['flex height only', 'flex:0 1 auto;height:63.25px;width:auto', 'display:flex;align-items:baseline;width:293.75px'],
  ['transform', 'height:51.75px;width:auto;transform:rotate(7deg) scale(.83)', ''],
]) {
  it(`preserves complete SnapDOM pixels and source geometry for ${name}`, async () => {
    const { root, source } = await fixture(imageCss)
    root.style.cssText += rootCss
    const originalMarkup = root.outerHTML
    const geometry = Array.from(root.children, node => node.getBoundingClientRect().toJSON())
    const baseline = await snapdom(root, { ...options, plugins: [{ name: 'test-original-resource', afterClone(state) {
      // Compare the original image path, without exposing a production opt-out.
      state.nodeMap.delete(state.clone.querySelector('img'))
    } }] })
    const candidate = await snapdom(root, options)
    expect(decodeURIComponent(baseline.url)).toContain(source.src)
    const svg = decodeURIComponent(candidate.url)
    expect(svg).not.toContain(source.src)
    const parsed = new DOMParser().parseFromString(svg.slice(svg.indexOf(',') + 1), 'image/svg+xml')
    const image = parsed.querySelector('img')
    expect(image.id).toBe('hidden-intrinsic')
    expect(image.getAttribute('data-label')).toBe('preserve')
    expect(decodeURIComponent(image.getAttribute('src'))).toContain('width="211" height="97"')
    const a = await baseline.toCanvas(), b = await candidate.toCanvas()
    try {
      expect([b.width, b.height]).toEqual([a.width, a.height])
      expect(b.getContext('2d').getImageData(0, 0, b.width, b.height).data).toEqual(a.getContext('2d').getImageData(0, 0, a.width, a.height).data)
    } finally { a.width = a.height = b.width = b.height = 0 }
    expect(root.outerHTML).toBe(originalMarkup)
    expect(Array.from(root.children, node => node.getBoundingClientRect().toJSON())).toEqual(geometry)
  })
}

it('does not fetch the hidden decoded source or retain it in the image URL', async () => {
  const { root, source } = await fixture()
  const clone = root.cloneNode(true), image = clone.querySelector('img')
  const fetch = vi.spyOn(globalThis, 'fetch')
  await inlineImages(clone, { __session: { nodeMap: new Map([[image, source]]), styleCache: new WeakMap([[source, { visibility: 'hidden' }]]) } })
  expect(fetch).not.toHaveBeenCalled()
  expect(image.src).not.toBe(source.src)
  await image.decode()
  expect([image.naturalWidth, image.naturalHeight]).toEqual([source.naturalWidth, source.naturalHeight])
})

it('keeps ordinary technical failure behavior when the hidden source is not decoded', async () => {
  const source = document.createElement('img'), clone = document.createElement('div'), image = document.createElement('img')
  source.style.visibility = 'hidden'; source.src = 'data:image/png;base64,invalid'
  await source.decode().catch(() => {})
  image.src = 'https://failed-image.invalid/image.png'; clone.append(image)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
  await inlineImages(clone, { placeholders: false, __session: { nodeMap: new Map([[image, source]]), styleCache: new WeakMap([[source, { visibility: 'hidden' }]]) } })
  expect(fetch).toHaveBeenCalled()
  expect(clone.querySelector('img')).toBeNull()
})
