import { afterEach, describe, expect, it } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'

const mounted = []
function mount(node) { document.body.append(node); mounted.push(node); return node }
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })

async function copy(root) {
  const result = await prepareClone(root, {
    __session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() },
  })
  const host = mount(document.createElement('div'))
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = result.classCSS
  shadow.append(style, result.clone)
  return result.clone
}

describe('intrinsic width in frozen CSS', () => {
  for (const width of ['max-content', 'min-content', 'fit-content']) {
    it(`preserves inline ${width} and its max-width constraint`, async () => {
      const root = mount(document.createElement('div'))
      root.style.cssText = 'width:400px;font:17px Arial'
      root.innerHTML = `<div style="width:${width};max-width:160px;padding:4px 10px">A label with several words</div>`
      const clone = await copy(root)
      // Firefox has no Typed OM; its existing used-width path still has to
      // preserve the rendered box and constraints. Do not infer the cascade
      // from an inline declaration that a stylesheet may override.
      if (typeof root.computedStyleMap === 'function') {
        expect(clone.firstElementChild.style.width).toBe(width)
      }
      expect(getComputedStyle(clone.firstElementChild).maxWidth).toBe('160px')
      expect(clone.firstElementChild.getBoundingClientRect().width)
        .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
    })
  }

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('preserves stylesheet content sizing in Typed OM instead of freezing a rounded used width', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.intrinsic-panel{display:flex;width:max-content;padding:0 10px}.intrinsic-panel span{font:17px Arial}'
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:500px;zoom:.75'
    root.innerHTML = '<section class="intrinsic-panel"><span>Network: 6 KB/s</span></section>'
    const clone = await copy(root)
    expect(String(clone.firstElementChild.computedStyleMap().get('width'))).toBe('max-content')
    expect(clone.firstElementChild.getBoundingClientRect().width)
      .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
  })

  it('honors a stylesheet important width over inline intrinsic sizing', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.fixed-panel{width:80px!important}'
    const root = mount(document.createElement('div'))
    root.innerHTML = '<div class="fixed-panel" style="width:max-content">A longer label</div>'
    const clone = await copy(root)
    expect(getComputedStyle(clone.firstElementChild).width).toBe('80px')
  })

  it('preserves stylesheet zoom on a descendant', async () => {
    const style = mount(document.createElement('style'))
    style.textContent = '.scaled-child{zoom:.75;width:200px;height:40px;padding:4px;font:16px Arial}'
    const root = mount(document.createElement('div'))
    root.innerHTML = '<div class="scaled-child">Scaled content</div>'
    const clone = await copy(root)
    expect(getComputedStyle(clone.firstElementChild).zoom).toBe('0.75')
    expect(clone.firstElementChild.getBoundingClientRect().width)
      .toBe(root.firstElementChild.getBoundingClientRect().width)
  })
  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('keeps auto inline-block text sized by content instead of overlapping the following separator', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:400px;font:15px Arial;zoom:.75'
    root.innerHTML = '<span style="display:inline-block;white-space:nowrap">Unnamed</span><span>:</span>'
    const clone = await copy(root)
    const name = clone.firstElementChild
    expect(String(name.computedStyleMap().get('width'))).toBe('auto')
    // A raster font can have different metrics. Content-sized boxes must grow
    // with their glyphs so the adjacent separator still follows the name.
    name.style.letterSpacing = '1px'
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth)
  })

  for (const [mode, property] of [['horizontal-tb', 'inline-size'], ['vertical-rl', 'block-size']]) {
    it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')(`preserves ${property} in ${mode}`, async () => {
      const root = mount(document.createElement('div'))
      root.style.cssText = 'width:400px;height:200px;font:17px Arial'
      root.innerHTML = `<div style="writing-mode:${mode};${property}:max-content">Content sized text</div>`
      const clone = await copy(root)
      expect(String(clone.firstElementChild.computedStyleMap().get('width'))).toBe('max-content')
      expect(clone.firstElementChild.getBoundingClientRect().width)
        .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
    })
  }

})
