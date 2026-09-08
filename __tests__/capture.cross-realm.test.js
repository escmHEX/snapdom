import { afterEach, describe, expect, it } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { snapdom } from '../src/api/snapdom.js'
import { inlineExternalDefsAndSymbols } from '../src/modules/svgDefs.js'
import { forceContentVisibility } from '../src/utils/prepare.helpers.js'

const frames = []
afterEach(() => { for (const frame of frames.splice(0)) frame.remove() })
async function frameWith(html) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:400px;height:300px;border:0'
  const loaded = new Promise(resolve => frame.onload = resolve)
  frame.srcdoc = `<!doctype html><html><head><style>body{margin:0}</style></head><body>${html}</body></html>`
  frames.push(frame)
  document.body.append(frame)
  await loaded
  return frame.contentDocument
}
async function prepare(root) {
  return prepareClone(root, { __session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() } })
}

describe('same-origin iframe capture', () => {
  it('serializes current form state and CSS-driven SVG paint from another realm', async () => {
    const doc = await frameWith('<style>rect{fill:rgb(0,128,0)}</style><div id="root"><input value="initial"><textarea>initial</textarea><select><option value="a">A</option><option value="b">B</option></select><svg width="20" height="20"><rect width="20" height="20"/></svg></div>')
    const root = doc.getElementById('root')
    expect(root instanceof HTMLElement).toBe(false)
    root.querySelector('input').value = 'current input'
    root.querySelector('textarea').value = 'current textarea'
    root.querySelector('select').value = 'b'
    const { clone } = await prepare(root)
    expect(clone.querySelector('input').getAttribute('value')).toBe('current input')
    expect(clone.querySelector('textarea').textContent).toBe('current textarea')
    expect(clone.querySelector('option[selected]').value).toBe('b')
    expect(clone.querySelector('rect').style.fill).toBe('rgb(0, 128, 0)')
  })

  it('resolves dependencies when the foreign SVG itself is the capture root', async () => {
    const doc = await frameWith('<svg><defs><linearGradient id="paint"><stop stop-color="green"/></linearGradient></defs></svg><svg id="root" width="20" height="20"><rect width="20" height="20" fill="url(#paint)"/></svg>')
    const root = doc.getElementById('root').cloneNode(true)
    await inlineExternalDefsAndSymbols(root, doc)
    expect(root.querySelector('linearGradient#paint')).not.toBeNull()
  })

  it('temporarily reveals foreign content-visibility:auto and restores it', async () => {
    const doc = await frameWith('<div id="root" style="content-visibility:auto"><div style="content-visibility:auto">text</div></div>')
    const root = doc.getElementById('root')
    const undo = forceContentVisibility(root)
    expect(root.style.contentVisibility).toBe('visible')
    expect(root.firstElementChild.style.contentVisibility).toBe('visible')
    undo()
    expect(root.style.contentVisibility).toBe('auto')
    expect(root.firstElementChild.style.contentVisibility).toBe('auto')
  })

  it('exports a foreign HTML subtree with forms and SVG to a painted canvas', async () => {
    const doc = await frameWith('<style>rect{fill:rgb(0,128,0)}</style><div id="root" style="position:relative;width:200px;height:140px;background:white"><input value="value"><textarea>text</textarea><select><option>option</option></select><svg style="position:absolute;left:0;top:110px" width="20" height="20"><rect width="20" height="20"/></svg></div>')
    const canvas = await snapdom.toCanvas(doc.getElementById('root'), { embedFonts: false, scale: 1, dpr: 1 })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(140)
    const pixel = canvas.getContext('2d').getImageData(10, 120, 1, 1).data
    expect(Array.from(pixel)).toEqual([0, 128, 0, 255])
    canvas.width = canvas.height = 0
  })
})
