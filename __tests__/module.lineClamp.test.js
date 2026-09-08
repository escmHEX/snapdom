import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapshotTextTruncation, lineClampTree } from '../src/modules/lineClamp.js'

afterEach(() => { document.body.innerHTML = '' })
const longText = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
function make(css, text = longText) {
  const source = document.createElement('div')
  source.style.cssText = 'width:200px;font:16px/20px Arial;' + css
  source.textContent = text
  document.body.appendChild(source)
  return source
}
async function bake(source) {
  const clone = source.cloneNode(true)
  snapshotTextTruncation(source, clone, getComputedStyle(source))
  await lineClampTree(clone, new Map([[clone, source]]))
  return clone
}
describe('capture-owned text truncation', async () => {
  it.each(['nowrap', 'pre'])('bakes clipped %s ellipsis without source writes', async whiteSpace => {
    const source = make(`text-overflow:ellipsis;white-space:${whiteSpace};overflow:hidden`)
    const observer = new MutationObserver(() => {})
    observer.observe(source, { subtree: true, childList: true, characterData: true, attributes: true })
    expect((await bake(source)).textContent).toContain('…')
    expect(source.textContent).toBe(longText)
    expect(observer.takeRecords()).toHaveLength(0)
    observer.disconnect()
  })
  it.each(['', 'text-overflow:ellipsis;white-space:normal;overflow:hidden', 'text-overflow:ellipsis;white-space:nowrap;overflow:visible'])('leaves ineligible text unchanged (%s)', async css => {
    expect((await bake(make(css))).textContent).toBe(longText)
  })
  it('leaves short text unchanged', async () => {
    expect((await bake(make('text-overflow:ellipsis;white-space:nowrap;overflow:hidden', 'Short'))).textContent).toBe('Short')
  })
  it('clamps multiple lines', async () => {
    expect((await bake(make('display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden'))).textContent).toContain('…')
  })
  it('preserves the font strut when line height is smaller than font size (#443)', async () => {
    const run = async height => (await bake(make(`font-size:20px;line-height:${height}px;word-break:break-word;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden`))).textContent
    expect(await run(18)).toBe(await run(24))
  })
  it('ignores containers with element children', async () => {
    const source = make('text-overflow:ellipsis;white-space:nowrap;overflow:hidden')
    source.appendChild(document.createElement('span'))
    expect((await bake(source)).textContent).toBe(longText)
  })
  it('uses snapshotted text and width after concurrent source updates', async () => {
    const source = make('text-overflow:ellipsis;white-space:nowrap;overflow:hidden')
    const expected = (await bake(source)).textContent
    const clone = source.cloneNode(true)
    snapshotTextTruncation(source, clone, getComputedStyle(source))
    source.firstChild.data = 'New application state'
    source.style.width = '800px'
    await lineClampTree(clone, new Map([[clone, source]]))
    expect(clone.textContent).toBe(expected)
    expect(source.textContent).toBe('New application state')
    expect(source.style.width).toBe('800px')
  })
  it('does not mount a measurement host without candidates', async () => {
    const source = make('')
    const observer = new MutationObserver(() => {})
    observer.observe(document.body, { childList: true })
    await bake(source)
    expect(observer.takeRecords()).toHaveLength(0)
    observer.disconnect()
  })
  it('retains whole Unicode graphemes at the truncation boundary', async () => {
    const grapheme = '👩🏽‍💻é'
    const source = make('text-overflow:ellipsis;white-space:nowrap;overflow:hidden;width:103px', grapheme.repeat(20))
    const output = (await bake(source)).textContent
    expect(output.endsWith('…')).toBe(true)
    const prefix = output.slice(0, -1)
    const ends = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source.textContent), item => item.index + item.segment.length)
    expect(ends).toContain(prefix.length)
    expect(source.textContent.startsWith(prefix)).toBe(true)
  })
  it('measures inherited fonts, normal line height, and padding', async () => {
    const source = make('display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;padding:8px 12px;box-sizing:border-box;font:inherit')
    document.body.style.font = '18px/normal Georgia'
    expect((await bake(source)).textContent).toContain('…')
    document.body.style.font = ''
  })
  it('cleans up the isolated host when measuring throws', async () => {
    const source = make('text-overflow:ellipsis;white-space:nowrap;overflow:hidden')
    const clone = source.cloneNode(true)
    snapshotTextTruncation(source, clone, getComputedStyle(source))
    const read = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => { throw new Error('measurement failure') })
    try {
      await expect(lineClampTree(clone, new Map([[clone, source]]))).rejects.toThrow('measurement failure')
    } finally {
      read.mockRestore()
    }
    expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
    expect(source.textContent).toBe(longText)
  })
  it('cleans the measurement host when processing is aborted', async () => {
    const source = make('text-overflow:ellipsis;white-space:nowrap;overflow:hidden')
    const clone = source.cloneNode(true)
    snapshotTextTruncation(source, clone, getComputedStyle(source))
    let calls = 0
    const options = { __scheduler: { checkpoint() {
      if (++calls > 1) throw new DOMException('Aborted', 'AbortError')
      return null
    } } }
    await expect(lineClampTree(clone, new Map([[clone, source]]), '', options)).rejects.toMatchObject({ name: 'AbortError' })
    expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
    expect(source.textContent).toBe(longText)
  })

  it('measures prepared pseudo content alongside text', async () => {
    const source = make('font:20px Arial;width:180px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3))
    const withoutPrefix = (await bake(source)).textContent
    const clone = source.cloneNode(true)
    snapshotTextTruncation(source, clone, getComputedStyle(source))
    const pseudo = document.createElement('span')
    pseudo.style.cssText = 'display:inline;font:inherit'
    pseudo.textContent = 'PREFIX '
    clone.prepend(pseudo)
    await lineClampTree(clone, new Map([[clone, source]]))
    const text = Array.from(clone.childNodes).filter(n => n.nodeType === 3).map(n => n.data).join('')
    expect(text.endsWith('…')).toBe(true)
    expect(text.length).toBeLessThan(withoutPrefix.length)
    expect(clone.firstElementChild.textContent).toBe('PREFIX ')
    document.body.appendChild(clone)
    expect(clone.scrollWidth).toBeLessThanOrEqual(clone.clientWidth + 1)
  })
  it('keeps capture available without Segmenter and never splits a surrogate pair', async () => {
    const original = Intl.Segmenter
    try {
      Intl.Segmenter = undefined
      const output = (await bake(make('width:103px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden', '😀'.repeat(30)))).textContent
      expect(output.endsWith('…')).toBe(true)
      expect(Array.from(output.slice(0, -1)).every(point => point === '😀')).toBe(true)
    } finally { Intl.Segmenter = original }
  })

})
