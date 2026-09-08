import { afterEach, describe, expect, it } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'

const mounted = []
function mount(node) { document.body.append(node); mounted.push(node); return node }
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })

function fixture(width, valueWidth = '') {
  const root = document.createElement('div')
  root.style.cssText = `display:flex;width:${width}px;gap:4px;font:16px Arial;line-height:20px`
  root.innerHTML = '<span class="value">ABCDEFGHI</span><span class="adjacent">X</span>'
  root.firstChild.style.cssText = `min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${valueWidth}`
  root.lastChild.style.cssText = 'flex:0 0 20px'
  return mount(root)
}

async function copy(root) {
  const result = await prepareClone(root, {
    __session: { styleMap:new Map(), styleCache:new WeakMap(), nodeMap:new Map() }
  })
  const style = document.createElement('style')
  style.textContent = result.classCSS
  // Source stylesheets are absent from the exported SVG. Isolate the generated
  // classes so an authored rule cannot accidentally mask a lost captured width.
  const host = mount(document.createElement('div'))
  host.attachShadow({mode:'open'}).append(style, result.clone)
  return result.clone
}

function metrics(root) {
  const value = root.querySelector('.value')
  const range = document.createRange()
  range.selectNodeContents(value)
  const rect = value.getBoundingClientRect()
  return {
    width:rect.width,
    textWidth:range.getBoundingClientRect().width,
    adjacent:root.querySelector('.adjacent').getBoundingClientRect().left - root.getBoundingClientRect().left
  }
}

describe('intrinsic ellipsis flex items', () => {
  for (const density of [1, 1.25, 2]) {
    it(`keeps fitting text and adjacent layout at density ${density}`, async () => {
      const root = fixture(300)
      const clone = await copy(root)
      root.style.zoom = clone.style.zoom = String(density)
      const native = metrics(root), actual = metrics(clone)
      expect(actual.width).toBe(native.width)
      expect(actual.adjacent).toBe(native.adjacent)
      expect(actual.textWidth).toBeLessThanOrEqual(actual.width)
    })
  }

  it('preserves an authored fixed width and its real overflow', async () => {
    const style = document.createElement('style')
    style.textContent = '.authored-width .value{width:40px}'
    mount(style)
    const root = fixture(300)
    root.className = 'authored-width'
    const clone = await copy(root)
    root.style.zoom = clone.style.zoom = '1.25'
    const native = metrics(root), actual = metrics(clone)
    expect(actual.width).toBe(native.width)
    expect(actual.adjacent).toBe(native.adjacent)
    expect(actual.textWidth).toBeGreaterThan(actual.width)
    expect(getComputedStyle(clone.firstChild).textOverflow).toBe('ellipsis')
  })

  it('keeps auto items constrained by their flex container', async () => {
    const root = fixture(80)
    const clone = await copy(root)
    root.style.zoom = clone.style.zoom = '1.25'
    const native = metrics(root), actual = metrics(clone)
    expect(actual.width).toBe(native.width)
    expect(actual.adjacent).toBe(native.adjacent)
    expect(actual.textWidth).toBeGreaterThan(actual.width)
  })
})
