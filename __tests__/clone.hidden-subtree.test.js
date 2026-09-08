import { afterEach, expect, it, vi } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { inlineImages } from '../src/modules/images.js'
import { TRANSPARENT_PNG } from '../src/utils/image.constants.js'

const mounted = []
function mount(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  mounted.push(root)
  return root
}
afterEach(() => { vi.restoreAllMocks(); for (const node of mounted.splice(0)) node.remove() })
async function prepare(root) {
  return prepareClone(root, {
    fast: true, cache: 'soft',
    __session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  })
}
it('prunes unpainted HTML descendants without changing the hidden root or siblings', async () => {
  const root = mount('<div class="hidden" style="display:none"><b>unpainted</b><input value="unused"></div><span>visible</span>')
  const before = root.innerHTML
  const result = await prepare(root)
  expect(root.innerHTML).toBe(before)
  const hidden = result.clone.querySelector('.hidden')
  expect(hidden.style.display).toBe('none')
  expect(hidden.childNodes.length).toBe(0)
  expect(result.clone.lastElementChild.textContent).toBe('visible')
  expect(Array.from(result.nodeMap.values())).not.toContain(root.querySelector('b'))
})
it('keeps hidden image topology without requesting or serializing its resource', async () => {
  const source = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  const root = mount(`<img id="hidden-resource" class="role-icon" data-role="original" style="display:none" src="${source}" srcset="${source} 1x" sizes="20px"><span>visible</span>`)
  const original = root.innerHTML
  const result = await prepare(root)
  const fetch = vi.spyOn(globalThis, 'fetch')
  await inlineImages(result.clone)
  expect(fetch).not.toHaveBeenCalled()
  const hidden = result.clone.firstElementChild
  expect(hidden.tagName).toBe('IMG')
  expect(hidden.id).toBe('hidden-resource')
  expect(hidden.className).toBe('role-icon')
  expect(hidden.getAttribute('data-role')).toBe('original')
  expect(hidden.style.getPropertyValue('display')).toBe('none')
  expect(hidden.style.getPropertyPriority('display')).toBe('important')
  expect(hidden.getAttribute('src')).toBe(TRANSPARENT_PNG)
  expect(hidden.hasAttribute('srcset')).toBe(false)
  expect(hidden.hasAttribute('sizes')).toBe(false)
  expect(new XMLSerializer().serializeToString(result.clone)).not.toContain(source)
  expect(root.innerHTML).toBe(original)
})
it('does not prune visibility:hidden descendants that can override visibility', async () => {
  const result = await prepare(mount('<div style="visibility:hidden"><b style="visibility:visible">visible child</b></div>'))
  expect(result.clone.querySelector('b')?.textContent).toBe('visible child')
})
it('preserves SVG definitions inside display:none HTML for visible references', async () => {
  const root = mount('<div style="display:none"><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs></svg></div><svg><rect width="10" height="10" fill="url(#paint)"/></svg>')
  const result = await prepare(root)
  expect(result.clone.querySelector('linearGradient#paint')).not.toBeNull()
  expect(result.clone.querySelector('rect')).not.toBeNull()
})
