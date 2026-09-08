import { afterEach, describe, expect, it } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { shrinkAutoSizeBoxes } from '../src/utils/capture.helpers.js'

const mounted = []
function mount(node) {
  document.body.append(node)
  mounted.push(node)
  return node
}
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })

async function prepare(root, options = {}) {
  return prepareClone(root, {
    ...options,
    __session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  })
}
function mountClone(result) {
  const css = document.createElement('style')
  css.textContent = result.classCSS
  mount(css)
  mount(result.clone)
}

describe('capture layout fidelity', () => {
  it('matches mapped descendants after a removed canvas and preserves their constraints', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<canvas data-capture="exclude"></canvas><div><div><b>nested</b><i>text</i></div></div><section style="display:flex"><span class="counter">7</span></section>'
    const css = document.createElement('style')
    css.textContent = '.counter { display:inline-block; min-width:48px; max-width:60px; overflow:hidden; }'
    mount(css)
    mount(root)
    const result = await prepare(root, { excludeMode: 'remove' })
    const counter = result.clone.querySelector('.counter')
    const before = counter.style.cssText
    shrinkAutoSizeBoxes(root, result.clone, result.styleCache, result.nodeMap)
    expect(counter.style.cssText).toBe(before)
    expect(result.clone.querySelector('canvas')).toBeNull()
    mountClone(result)
    expect(getComputedStyle(counter).minWidth).toBe('48px')
    expect(getComputedStyle(counter).overflow).toBe('hidden')
    expect(counter.getBoundingClientRect().width).toBeCloseTo(root.querySelector('.counter').getBoundingClientRect().width, 1)
  })

  it('shrinks a real removal even when a generated pseudo replaces its child count', async () => {
    const css = document.createElement('style')
    css.textContent = '.shrink-parent { min-height:12px; max-height:100px; overflow:hidden; } .shrink-parent::before { content:"prefix"; }'
    mount(css)
    const root = document.createElement('div')
    root.innerHTML = '<div class="shrink-parent"><div data-capture="exclude">removed</div><span>kept</span></div>'
    mount(root)
    const result = await prepare(root, { excludeMode: 'remove' })
    const parent = result.clone.querySelector('.shrink-parent')
    expect(parent.childElementCount).toBe(root.firstElementChild.childElementCount)
    shrinkAutoSizeBoxes(root, result.clone, result.styleCache, result.nodeMap)
    expect(parent.style.height).toBe('auto')
    expect(parent.style.minHeight).not.toBe('0px')
    mountClone(result)
    expect(getComputedStyle(parent).minHeight).toBe('12px')
    expect(getComputedStyle(parent).maxHeight).toBe('100px')
    expect(getComputedStyle(parent).overflow).toBe('hidden')
  })

  it('keeps parent dimensions when only an out-of-flow child is removed', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<canvas style="position:fixed" data-capture="exclude"></canvas><span>kept</span>'
    mount(root)
    const result = await prepare(root, { excludeMode: 'remove' })
    const before = result.clone.style.cssText
    shrinkAutoSizeBoxes(root, result.clone, result.styleCache, result.nodeMap)
    expect(result.clone.style.cssText).toBe(before)
  })

  for (const display of ['flex', 'grid', 'inline']) {
    it(`preserves ${display} icon hosts after pseudo glyph rasterization`, async () => {
      const css = document.createElement('style')
      css.textContent = `.icon-host { display:${display}; gap:14px; align-items:center; font:20px/30px sans-serif; } .icon-host::before { content:"X"; font-family:"Test Icon", sans-serif; }`
      mount(css)
      const root = document.createElement('div')
      root.innerHTML = '<span class="icon-host"><span class="label">Icon label</span></span>'
      mount(root)
      const result = await prepare(root)
      const host = result.clone.querySelector('.icon-host')
      expect(host.dataset.snapdomHasIcon).toBe('true')
      expect(host.querySelector('[data-snapdom-pseudo] img')).not.toBeNull()
      mountClone(result)
      expect(getComputedStyle(host).display).toBe(display)
      if (display === 'flex') {
        const glyph = host.querySelector('[data-snapdom-pseudo]').getBoundingClientRect()
        const label = host.querySelector('.label').getBoundingClientRect()
        expect(label.left - glyph.right).toBeCloseTo(14, 1)
      } else if (display === 'inline') {
        expect(host.style.verticalAlign).toBe('middle')
        const glyph = host.querySelector('[data-snapdom-pseudo]').getBoundingClientRect()
        const label = host.querySelector('.label').getBoundingClientRect()
        expect(label.left).toBeGreaterThanOrEqual(glyph.right - 1)
        expect(Math.abs(label.top - glyph.top)).toBeLessThan(5)
      }
    })
  }
})
