import { afterEach, describe, expect, it } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { generateDedupedBaseCSS } from '../src/utils/css.js'

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
  style.textContent = generateDedupedBaseCSS(new Set([root, ...root.querySelectorAll('*')].map(node => node.localName))) + result.classCSS
  shadow.append(style, result.clone)
  return result.clone
}

describe('intrinsic width in frozen CSS', () => {
  for (const zoom of [1, .9, 1.25]) {
    for (const inline of [false, true]) {
      it(`preserves fractional border thickness at zoom ${zoom}, inline ${inline}`, async () => {
        const sheet = mount(document.createElement('style'))
        sheet.textContent = '.fractional-border { width:27px;height:27px;box-sizing:border-box;border-radius:50%;border:3px solid green }'
        const root = mount(document.createElement('div'))
        root.style.cssText = `width:300px;height:100px;zoom:${zoom}`
        root.innerHTML = `<div class="fractional-border"${inline ? ' style="border:3px solid green"' : ''}></div>`
        const clone = await copy(root)
        for (const side of ['top', 'right', 'bottom', 'left']) {
          expect(getComputedStyle(clone.firstElementChild).getPropertyValue(`border-${side}-width`))
            .toBe(getComputedStyle(root.firstElementChild).getPropertyValue(`border-${side}-width`))
        }
        expect(clone.firstElementChild.getBoundingClientRect().width)
          .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
      })
    }
  }

  for (const zoom of [1, .9]) {
    for (const offset of [-4, 30]) {
      it(`preserves percentage contributions to intrinsic width at zoom ${zoom} with offset ${offset}`, async () => {
        const root = mount(document.createElement('div'))
        root.style.cssText = `width:800px;display:flex;align-items:flex-end;zoom:${zoom}`
        root.innerHTML = `<div style="display:flex;flex-direction:column;width:max-content;min-width:300px;flex:0 0 auto"><div style="width:300px;height:30px"></div><div style="width:calc(100% + ${offset}px);min-width:295px;height:30px"></div></div><div style="width:27px;height:27px;flex:none;border:3px solid green;border-radius:50%;box-sizing:border-box"></div>`
        const clone = await copy(root)
        // A percentage contributes differently to intrinsic sizing than its used
        // pixel width. The following control must stay at the click-time position.
        expect(clone.firstElementChild.getBoundingClientRect().width)
          .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
        expect(clone.lastElementChild.getBoundingClientRect().left - clone.getBoundingClientRect().left)
          .toBeCloseTo(root.lastElementChild.getBoundingClientRect().left - root.getBoundingClientRect().left, 1)
        expect(clone.firstElementChild.lastElementChild.getBoundingClientRect().width)
          .toBeCloseTo(root.firstElementChild.lastElementChild.getBoundingClientRect().width, 1)
      })
    }
  }

  it('keeps nested percentage input sizing out of intrinsic contributions', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:800px;display:flex;zoom:.9'
    root.innerHTML = '<div style="display:flex;flex-direction:column;width:max-content;min-width:300px;flex:none"><div style="width:300px;height:30px"></div><div style="display:flex;width:calc(100% + 30px);min-width:295px;height:30px;gap:4px"><input style="width:100%;flex:1 1 0;min-width:0;box-sizing:border-box"><button style="width:30px;flex:0 0 30px">A</button><button style="width:30px;flex:0 0 30px">B</button><button style="width:30px;flex:0 0 30px">C</button></div></div><div style="width:27px;flex:none"></div>'
    const clone = await copy(root)
    expect(clone.firstElementChild.getBoundingClientRect().width)
      .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
    expect(clone.lastElementChild.getBoundingClientRect().left - clone.getBoundingClientRect().left)
      .toBeCloseTo(root.lastElementChild.getBoundingClientRect().left - root.getBoundingClientRect().left, 1)
    expect(clone.querySelector('input').getBoundingClientRect().width)
      .toBeCloseTo(root.querySelector('input').getBoundingClientRect().width, 1)
  })

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('does not restore an excluded unitless line height', async () => {
    const sheet = mount(document.createElement('style'))
    sheet.textContent = '.excluded-line-height { line-height: 1.75 }'
    const root = mount(document.createElement('div'))
    root.className = 'excluded-line-height'
    root.textContent = 'Excluded property'
    const result = await prepareClone(root, {
      excludeStyleProps: prop => prop === 'line-height',
      __session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() },
    })
    const emitted = new CSSStyleSheet()
    emitted.replaceSync(result.classCSS)
    expect([...emitted.cssRules].some(rule => rule.style?.lineHeight)).toBe(false)
  })

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('preserves unitless line height through fractional CSS zoom', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:300px;zoom:.9;font:14px/1.428571 Arial'
    root.innerHTML = '<p style="font-size:15px;margin:0">First line<br>Second line<br>Third line</p><p>Following message</p>'
    const clone = await copy(root)
    // Model an effective font-size change in SVG rasterization: a unitless
    // line height must still scale with the font instead of keeping old pixels.
    for (const tree of [root, clone]) tree.firstElementChild.style.fontSize = '15.5px'
    for (let i = 0; i < root.children.length; i++) {
      expect(clone.children[i].getBoundingClientRect().height)
        .toBeCloseTo(root.children[i].getBoundingClientRect().height, 1)
    }
  })

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('keeps automatic block heights responsive to raster text wrapping', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:max-content;font:17px/1.25 Arial'
    root.innerHTML = '<section style="padding:10px;border:2px solid red"><p style="margin:0;text-align:justify">A message near its wrap boundary</p></section><p>Following message</p>'
    root.style.width = `${root.getBoundingClientRect().width}px`
    const clone = await copy(root)
    const before = root.firstElementChild.getBoundingClientRect().height
    for (const tree of [root, clone]) {
      tree.querySelector('section p').style.letterSpacing = '0.1px'
    }
    expect(root.firstElementChild.getBoundingClientRect().height).toBeGreaterThan(before)
    for (let i = 0; i < root.children.length; i++) {
      expect(clone.children[i].getBoundingClientRect().height)
        .toBeCloseTo(root.children[i].getBoundingClientRect().height, 1)
      expect(clone.children[i].getBoundingClientRect().top - clone.getBoundingClientRect().top)
        .toBeCloseTo(root.children[i].getBoundingClientRect().top - root.getBoundingClientRect().top, 1)
    }
  })

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('lets an auto flex row grow with its intrinsic labels after raster metric drift', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:600px;display:flex;flex-direction:column;align-items:flex-start;font:17px Arial'
    root.innerHTML = '<div style="display:flex;gap:6px"><div style="display:flex;width:max-content;padding:0 10px;height:25px"><span>Score: 1689</span></div><div style="display:flex;width:max-content;padding:0 10px;height:25px"><span>Network: 3 KB/s</span></div></div>'
    const clone = await copy(root)
    // Native OS scaling changes SVG font metrics without changing CSS sizes.
    // Model that drift in both trees: an auto row must still size to its children.
    for (const tree of [root, clone]) {
      for (const label of tree.querySelectorAll('span')) label.style.letterSpacing = '0.1px'
    }
    expect(clone.firstElementChild.getBoundingClientRect().width)
      .toBeCloseTo(root.firstElementChild.getBoundingClientRect().width, 1)
    for (const label of clone.querySelectorAll('span')) {
      const range = document.createRange()
      range.selectNodeContents(label)
      expect(range.getClientRects().length).toBe(1)
    }
  })

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('keeps auto margins available when centered table text grows', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'width:300px;font:17px Arial'
    root.innerHTML = '<span style="display:table;margin:auto">Restart time: 59 min</span>'
    const clone = await copy(root)
    for (const tree of [root, clone]) tree.firstElementChild.style.letterSpacing = '0.1px'
    const native = root.firstElementChild.getBoundingClientRect()
    const actual = clone.firstElementChild.getBoundingClientRect()
    expect(actual.height).toBe(native.height)
    expect(actual.width).toBeCloseTo(native.width, 1)
    expect(actual.left - clone.getBoundingClientRect().left)
      .toBeCloseTo(native.left - root.getBoundingClientRect().left, 1)
  })

  it.skipIf(typeof Element.prototype.computedStyleMap !== 'function')('keeps an absolute auto row anchored when its text grows', async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = 'position:relative;width:500px;height:100px;font:17px Arial'
    root.innerHTML = '<div style="position:absolute;right:10px;top:0;display:flex"><span>0 people watching you</span></div>'
    const clone = await copy(root)
    for (const tree of [root, clone]) tree.firstElementChild.firstElementChild.style.letterSpacing = '0.2px'
    const native = root.firstElementChild.getBoundingClientRect()
    const actual = clone.firstElementChild.getBoundingClientRect()
    expect(actual.width).toBeCloseTo(native.width, 1)
    expect(actual.height).toBe(native.height)
    expect(clone.getBoundingClientRect().right - actual.right).toBeCloseTo(10, 1)
  })

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
