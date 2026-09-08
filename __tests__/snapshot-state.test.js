import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapshot, materializeSnapshot } from '../src/core/snapshot.js'

const cleanup = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })
function mount(tag, text) {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  document.body.appendChild(node); cleanup.push(() => node.remove())
  return node
}
async function materialize(state) {
  const result = await materializeSnapshot(state)
  cleanup.push(() => result.dispose())
  return result
}

describe('structural snapshot state', () => {
  it('preserves stylesheet tags, attributes and sibling selectors with frozen CSSOM', async () => {
    const root = mount('div')
    root.innerHTML = '<style id="snapshot-owned-style" class="sheet" data-owner="original">#snapshot-owned-style.sheet[data-owner="original"] + span{padding-left:17px}</style><span>styled sibling</span><link id="snapshot-owned-link" class="sheet" rel="stylesheet"><b>linked sibling</b>'
    const link = root.querySelector('link')
    link.href = 'data:text/css,' + encodeURIComponent('#snapshot-owned-link.sheet[href$="#original"] + b{padding-left:23px}') + '#original'
    await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject })
    link.sheet.insertRule('#snapshot-owned-link + b{color:rgb(1,2,3)}')
    const state = snapshot(root); cleanup.push(() => state.dispose())
    link.sheet.cssRules[0].style.color = 'red'
    const result = await materialize(state), view = result.element.ownerDocument.defaultView
    expect(Array.from(result.element.children, node => node.localName)).toEqual(['style', 'span', 'link', 'b'])
    expect(result.element.firstChild.id).toBe('snapshot-owned-style')
    expect(result.element.firstChild.getAttribute('data-owner')).toBe('original')
    expect(view.getComputedStyle(result.element.querySelector('span')).paddingLeft).toBe('17px')
    expect(view.getComputedStyle(result.element.querySelector('b')).paddingLeft).toBe('23px')
    expect(view.getComputedStyle(result.element.querySelector('b')).color).toBe('rgb(1, 2, 3)')
  })

  it('captures the same custom-property suffix as full native enumeration', async () => {
    const style = mount('style'); style.textContent = 'body{--inherited-snapshot:17px}@property --registered-snapshot{syntax:"<length>";inherits:true;initial-value:7px}'
    const root = mount('div'); root.style.cssText = '--Z-snapshot:rgb(1,2,3);--a-snapshot:env(safe-area-inset-top,0px);color:red'
    const computed = getComputedStyle(root)
    const full = Array.from(computed).filter(name => name.startsWith('--')).sort()
    const suffix = []
    for (let index = computed.length - 1; index >= 0; index--) {
      if (!computed[index].startsWith('--')) break
      suffix.push(computed[index])
    }
    expect(suffix.sort()).toEqual(full)
    expect(full).toContain('--inherited-snapshot')
    expect(full).toContain('--Z-snapshot')
    const state = snapshot(root); cleanup.push(() => state.dispose())
    expect(state.element.getAttribute('style')).toBe(root.getAttribute('style'))
    const result = await materialize(state)
    for (const name of full) {
      const value = computed.getPropertyValue(name)
      if (value && !/url\(/i.test(value)) expect(result.element.style.getPropertyValue(name)).toBe(value)
    }
  })

  it('preserves an invalid computed custom property without removing its original declaration', async () => {
    const style = mount('style'); style.textContent = '#snapshot-invalid-custom{--invalid:blue}'
    const root = mount('div'); root.id = 'snapshot-invalid-custom'
    root.style.setProperty('--invalid', 'var(--missing)')
    root.innerHTML = '<span style="color:var(--invalid,red)">invalid variable fallback</span>'
    const original = getComputedStyle(root.firstChild).color
    const state = snapshot(root); cleanup.push(() => state.dispose())
    const result = await materialize(state)
    expect(result.element.ownerDocument.defaultView.getComputedStyle(result.element.firstChild).color).toBe(original)
  })

  it('preserves relative URL semantics of computed custom properties from external stylesheets', async () => {
    const link = mount('link'); link.rel = 'stylesheet'
    const loaded = new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject })
    link.href = new URL('./fixtures/snapshot-custom-properties.css', import.meta.url).href
    await loaded
    const root = mount('div'); root.id = 'snapshot-external-custom'; root.textContent = 'image'
    const original = getComputedStyle(root).backgroundImage
    const state = snapshot(root); cleanup.push(() => state.dispose())
    const result = await materialize(state)
    expect(result.element.ownerDocument.defaultView.getComputedStyle(result.element).backgroundImage).toBe(original)
  })

  it('keeps detached copied ancestry and restores :root selectors when materialized', async () => {
    const frame = mount('iframe'), doc = frame.contentDocument
    doc.head.innerHTML = '<style>:root body > #root{color:rgb(17, 34, 51)}#sibling + #root{margin-left:23px}</style>'
    doc.body.innerHTML = '<div id="sibling"></div><div id="root">root</div>'
    const state = snapshot(doc.documentElement); cleanup.push(() => state.dispose())
    expect(state.element.parentNode).toBeNull()
    expect(state.element.ownerDocument.defaultView).toBeNull()
    expect(state.element.querySelector('#sibling + #root')).toBeTruthy()
    const result = await materialize(state)
    expect(result.element.matches(':root')).toBe(true)
    const computed = result.element.ownerDocument.defaultView.getComputedStyle(result.element.querySelector('#root'))
    expect(computed.color).toBe('rgb(17, 34, 51)')
    expect(computed.marginLeft).toBe('23px')
  })

  it('freezes inherited computed custom properties including environment substitutions at the root', async () => {
    const root = mount('div'), parent = root.parentNode
    const style = mount('style'); style.textContent = 'body{--snapshot-safe:env(safe-area-inset-top,0px);--snapshot-color:rgb(12,34,56)}'
    root.innerHTML = '<span style="color:var(--snapshot-color);padding-top:var(--snapshot-safe)">custom</span>'
    const computed = getComputedStyle(root), safe = computed.getPropertyValue('--snapshot-safe')
    const state = snapshot(root); cleanup.push(() => state.dispose())
    expect(state.element.hasAttribute('style')).toBe(false)
    parent.style.setProperty('--snapshot-color', 'red'); cleanup.push(() => parent.style.removeProperty('--snapshot-color'))
    const result = await materialize(state)
    expect(result.element.style.getPropertyValue('--snapshot-safe')).toBe(safe)
    expect(result.element.style.getPropertyPriority('--snapshot-safe')).toBe('important')
    expect(result.element.ownerDocument.defaultView.getComputedStyle(result.element.firstChild).color).toBe('rgb(12, 34, 56)')
  })

  it('preserves style attribute predicates before adding frozen inline declarations', async () => {
    mount('style', 'body{--snapshot-color:red}.snapshot-style{padding-left:3px}.snapshot-style[style]{padding-left:17px}.snapshot-style[style*="color"]{padding-top:19px}.snapshot-style[st\\79 le]{margin-left:13px}.snapshot-style[data-label="[style]"]{margin-top:11px}')
    for (const attribute of [null, '', 'color: rgb(1, 2, 3)']) {
      const root = mount('div'); root.className = 'snapshot-style'; root.setAttribute('data-label', '[style]')
      if (attribute !== null) root.setAttribute('style', attribute)
      const before = getComputedStyle(root)
      const expected = [before.paddingLeft, before.paddingTop, before.marginLeft, before.marginTop]
      const state = snapshot(root); cleanup.push(() => state.dispose())
      expect(state.element.getAttribute('style')).toBe(attribute)
      root.style.cssText = 'color:blue;padding:100px'
      const result = await materialize(state)
      const computed = result.element.ownerDocument.defaultView.getComputedStyle(result.element)
      expect([computed.paddingLeft, computed.paddingTop, computed.marginLeft, computed.marginTop]).toEqual(expected)
    }
  })

  it('preserves the captured color scheme when the embedding context changes', async ({ skip }) => {
    const frame = mount('iframe'); frame.style.colorScheme = 'dark'
    const doc = frame.contentDocument
    doc.head.innerHTML = '<style>#root{color:black}@media(prefers-color-scheme:dark){#root{color:white}}</style>'
    const root = doc.createElement('div'); root.id = 'root'; root.textContent = 'scheme'; doc.body.appendChild(root)
    await new Promise(requestAnimationFrame)
    const color = doc.defaultView.getComputedStyle(root).color
    // Chromium's DevTools colorScheme override beats iframe CSS. The native
    // snapshot test config clears that override to exercise real embedding.
    if (color !== 'rgb(255, 255, 255)') skip('Requires native color scheme; run vitest.snapshot-native.config.js')
    expect(color).toBe('rgb(255, 255, 255)')
    const state = snapshot(root); cleanup.push(() => state.dispose())
    frame.style.colorScheme = 'light'
    await new Promise(requestAnimationFrame)
    expect(doc.defaultView.getComputedStyle(root).color).toBe('rgb(0, 0, 0)')
    const result = await materialize(state)
    expect(result.element.ownerDocument.defaultView.getComputedStyle(result.element).color).toBe(color)
  })

  it('rebases copied CSS only during processing using the base captured before source mutations', async () => {
    const frame = mount('iframe'), doc = frame.contentDocument
    doc.head.innerHTML = '<base href="https://example.test/original/"><style>#root{--frozen-image:url(icons/a.png)}#root::before{content:"url(leave-me-alone.png)"}</style>'
    const root = doc.createElement('div'); root.id = 'root'; root.textContent = 'URL'; doc.body.appendChild(root)
    const state = snapshot(root); cleanup.push(() => state.dispose())
    doc.querySelector('base').href = 'https://example.test/changed/'
    doc.querySelector('style').sheet.cssRules[0].style.setProperty('--frozen-image', 'url(new.png)')
    const result = await materialize(state), view = result.element.ownerDocument.defaultView
    expect(view.getComputedStyle(result.element).getPropertyValue('--frozen-image')).toContain('https://example.test/original/icons/a.png')
    expect(view.getComputedStyle(result.element, '::before').content).toBe('"url(leave-me-alone.png)"')
  })

  it('defers copied-attribute sanitation until processing but completes it before sandbox mounting', async () => {
    const root = mount('div')
    root.innerHTML = '<button onclick="window.snapshotInlineHandlerRan=true">button</button><script>window.snapshotInlineScriptRan=true</script>'
    const sourceMarkup = root.innerHTML, state = snapshot(root); cleanup.push(() => state.dispose())
    expect(state.element.ownerDocument.defaultView).toBeNull()
    expect(state.element.firstElementChild.hasAttribute('onclick')).toBe(true)
    let sawMount = false
    const append = document.body.appendChild
    const mounted = vi.spyOn(document.body, 'appendChild').mockImplementation(function (node) {
      if (node.hasAttribute?.('data-snapdom-sandbox')) {
        sawMount = true
        expect(node.style.display).toBe('none')
        expect(state.element.firstElementChild.hasAttribute('onclick')).toBe(false)
        expect(state.element.querySelector('script').type).toBe('application/x-snapdom-inert')
        expect(state.element.querySelector('script').textContent).toBe('')
      }
      return append.call(this, node)
    })
    try {
      const result = await materialize(state)
      expect(sawMount).toBe(true)
      expect(result.element.ownerDocument.defaultView.frameElement.style.display).toBe('')
      expect(result.element.getBoundingClientRect().height).toBeGreaterThan(0)
      expect(result.element.firstElementChild.hasAttribute('onclick')).toBe(false)
      expect(root.innerHTML).toBe(sourceMarkup)
    } finally { mounted.mockRestore() }
  })

  it('releases allocated canvas backing stores when acquisition fails later or during drawImage', () => {
    const root = mount('div'); root.innerHTML = '<canvas width="8" height="6"></canvas><video></video>'
    const buffers = [], original = CanvasRenderingContext2D.prototype.drawImage
    const draw = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (...args) {
      buffers.push(this.canvas)
      return original.apply(this, args)
    })
    try {
      expect(() => snapshot(root)).toThrow(/Unsupported snapshot content: video/)
      expect(buffers).toHaveLength(1)
      expect([buffers[0].width, buffers[0].height]).toEqual([0, 0])
      draw.mockImplementation(function () { buffers.push(this.canvas); throw new Error('readback failed') })
      expect(() => snapshot(root)).toThrow(/readback failed/)
      expect(buffers).toHaveLength(2)
      expect([buffers[1].width, buffers[1].height]).toEqual([0, 0])
      expect(root.firstElementChild.width).toBe(8)
    } finally { draw.mockRestore() }
  })
  it('preserves both standards and quirks parser modes', async () => {
    for (const doctype of ['<!DOCTYPE html>', '']) {
      const frame = mount('iframe'), doc = frame.contentDocument
      doc.open(); doc.write(`${doctype}<html><head></head><body><div style="width:100px;padding:10px;border:1px solid">box</div></body></html>`); doc.close()
      const root = doc.body.firstElementChild, width = root.getBoundingClientRect().width
      const state = snapshot(root); cleanup.push(() => state.dispose())
      const result = await materialize(state)
      expect(result.element.ownerDocument.compatMode).toBe(doc.compatMode)
      expect(result.element.getBoundingClientRect().width).toBe(width)
    }
  })

  it('preserves outside-root image geometry without fetching or awaiting its source', async () => {
    const outside = mount('img')
    outside.id = 'snapshot-outside-image'; outside.loading = 'lazy'
    outside.style.cssText = 'position:absolute;top:100000px;width:83px;height:22px'
    outside.src = 'https://snapshot-outside.invalid/never-load.png'
    const root = mount('div', 'captured root')
    const state = snapshot(root); cleanup.push(() => state.dispose())
    const result = await materializeSnapshot(state, { resourceTimeoutMs: 100 })
    cleanup.push(() => result.dispose())
    const copy = result.element.ownerDocument.getElementById(outside.id)
    expect(copy.getAttribute('src')).toBeNull()
    expect(copy.getAttribute('loading')).toBe('lazy')
    expect(copy.getBoundingClientRect().width).toBe(83)
    expect(copy.getBoundingClientRect().height).toBe(22)
    expect(result.element.ownerDocument.defaultView.performance.getEntriesByName(outside.src)).toHaveLength(0)
  })

  it('fails synchronously while a font is loading instead of producing a later-font snapshot', async () => {
    const root = mount('div', 'font state')
    const font = new FontFace('SnapshotPending', 'url(data:font/woff2;base64,d09GMg==)')
    document.fonts.add(font); cleanup.push(() => document.fonts.delete(font))
    const pending = font.load().catch(() => {})
    expect(document.fonts.status).toBe('loading')
    expect(() => snapshot(root)).toThrow(/pendingFonts/)
    expect(document.querySelector('[data-snapdom-sandbox]')).toBeNull()
    await pending
    document.fonts.delete(font)
    await document.fonts.ready
  })
  it('freezes text, CSSOM, ancestry, form state and scroll before deferred layout', async () => {
    const css = mount('style', '.snapshot-state-test{color:rgb(12,34,56)} .snapshot-scroll{height:30px;overflow:auto}')
    const ancestor = mount('section')
    ancestor.className = 'snapshot-state-test'
    ancestor.innerHTML = '<b>preceding sibling</b><div><span>before</span><input value="default"><div class="snapshot-scroll"><div style="height:200px">scroll</div></div></div>'
    const root = ancestor.lastElementChild, input = root.querySelector('input'), scroll = root.querySelector('.snapshot-scroll')
    input.value = 'click value'; scroll.scrollTop = 40
    const capturedScroll = scroll.scrollTop
    const state = snapshot(root); cleanup.push(() => state.dispose())
    const copiedInput = state.nodeFor(input)
    root.querySelector('span').textContent = 'after'; input.value = 'after'; scroll.scrollTop = 0
    css.sheet.cssRules[0].style.color = 'red'; ancestor.className = ''
    const result = await materialize(state)
    expect(result.element.querySelector('span').textContent).toBe('before')
    expect(result.nodeFor(copiedInput).value).toBe('click value')
    expect(result.nodeFor(scroll).scrollTop).toBe(capturedScroll)
    expect(result.element.ownerDocument.defaultView.getComputedStyle(result.element).color).toBe('rgb(12, 34, 56)')
    expect(result.element.previousElementSibling.textContent).toBe('preceding sibling')
  })

  it('freezes focus selectors inside functional selectors without rewriting quoted attribute text', async () => {
    mount('style', '.snapshot-focus:is(:focus){color:rgb(1,2,3)} [data-label=":focus"]{padding-left:7px}')
    const input = mount('input'); input.className = 'snapshot-focus'; input.setAttribute('data-label', ':focus'); input.focus()
    const state = snapshot(input); cleanup.push(() => state.dispose()); input.blur()
    const result = await materialize(state)
    const style = result.element.ownerDocument.defaultView.getComputedStyle(result.element)
    expect(style.color).toBe('rgb(1, 2, 3)'); expect(style.paddingLeft).toBe('7px')
  })

  it('freezes paused animated properties and inherited animated custom properties', async () => {
    const root = mount('div'); root.innerHTML = '<span style="opacity:var(--snapshot-alpha)">child</span>'
    const animation = root.animate([{ opacity: 0.2, '--snapshot-alpha': '0.3' }, { opacity: 0.8, '--snapshot-alpha': '0.7' }], { duration: 1000, fill: 'both' })
    animation.pause(); animation.currentTime = 200; cleanup.push(() => animation.cancel())
    const before = getComputedStyle(root).opacity, childBefore = getComputedStyle(root.firstElementChild).opacity
    const state = snapshot(root); cleanup.push(() => state.dispose()); animation.currentTime = 900
    const result = await materialize(state), view = result.element.ownerDocument.defaultView
    expect(view.getComputedStyle(result.element).opacity).toBe(before)
    expect(view.getComputedStyle(result.element.firstElementChild).opacity).toBe(childBefore)
  })

  it('preserves independent before and after animation values on the same element', async () => {
    mount('style', '@keyframes snapshot-pseudo{from{opacity:.1}to{opacity:.9}} .snapshot-pseudos::before,.snapshot-pseudos::after{content:"part";animation:snapshot-pseudo 1s linear both paused}')
    const root = mount('div'); root.className = 'snapshot-pseudos'
    const animations = root.getAnimations({ subtree: true })
    animations.forEach((animation, index) => { animation.currentTime = index ? 700 : 200 })
    const before = getComputedStyle(root, '::before').opacity, after = getComputedStyle(root, '::after').opacity
    const state = snapshot(root); cleanup.push(() => state.dispose())
    animations.forEach(animation => { animation.currentTime = 950 })
    const result = await materialize(state), view = result.element.ownerDocument.defaultView
    expect(view.getComputedStyle(result.element, '::before').opacity).toBe(before)
    expect(view.getComputedStyle(result.element, '::after').opacity).toBe(after)
  })

  it('keeps a pending image invisible even if its original changes before processing', async () => {
    const root = mount('div'); root.innerHTML = '<img width="35" height="22">'
    const image = root.firstElementChild
    const state = snapshot(root); cleanup.push(() => state.dispose())
    image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="35" height="22"><rect width="35" height="22" fill="red"/></svg>'
    const result = await materialize(state), copy = result.element.firstElementChild
    expect(copy.ownerDocument.defaultView.getComputedStyle(copy).visibility).toBe('hidden')
    expect(copy.getBoundingClientRect().width).toBe(35)
    expect(copy.getBoundingClientRect().height).toBe(22)
  })

  it('rejects aborted processing and ignores excluded media without mutating source', async () => {
    const root = mount('div'); root.innerHTML = '<iframe></iframe><canvas width="1" height="1"></canvas>'
    expect(() => snapshot(root)).toThrow(/Unsupported snapshot content/)
    const before = root.outerHTML, state = snapshot(root, { exclude: ['iframe', 'canvas'] }); cleanup.push(() => state.dispose())
    const signal = AbortSignal.abort()
    await expect(materializeSnapshot(state, { signal })).rejects.toBeDefined()
    expect(root.outerHTML).toBe(before)
    expect(document.querySelector('[data-snapdom-sandbox]')).toBeNull()
  })
})
