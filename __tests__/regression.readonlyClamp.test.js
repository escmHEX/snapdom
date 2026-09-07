import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

afterEach(() => { document.body.innerHTML = '' })
function fixture() {
  const root = document.createElement('section')
  root.style.cssText = 'width:220px;background:white'
  for (const css of ['white-space:nowrap;text-overflow:ellipsis', 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2']) {
    const text = document.createElement('div')
    text.style.cssText = 'width:200px;overflow:hidden;font:16px/20px Arial;' + css
    text.textContent = 'A long generic label with enough words to exceed the available space and require a visible ellipsis in the exported snapshot.'
    root.appendChild(text)
  }
  document.body.appendChild(root)
  return root
}
describe('readonly capture truncation', () => {
  it('exports nested ellipsis and clamp while preserving source nodes and all mutations', async () => {
    const source = fixture()
    const nodes = Array.from(source.children, child => child.firstChild)
    const text = source.textContent
    const records = []
    const observer = new MutationObserver(batch => records.push(...batch))
    observer.observe(source, { subtree: true, childList: true, characterData: true, attributes: true })
    let exported
    await snapdom(source, { embedFonts: false, cache: 'disabled', plugins: [{
      name: 'inspect-clone',
      afterClone({ clone }) { exported = Array.from(clone.children, child => child.textContent) },
    }] })
    records.push(...observer.takeRecords())
    observer.disconnect()
    expect(exported).toHaveLength(2)
    expect(exported.every(value => value.endsWith('…'))).toBe(true)
    expect(source.textContent).toBe(text)
    expect(Array.from(source.children, child => child.firstChild)).toEqual(nodes)
    expect(records).toHaveLength(0)
    expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
  })
  it('does not overwrite application text updated while an asynchronous capture is pending', async () => {
    const source = fixture()
    const node = source.firstChild.firstChild
    await snapdom(source, { embedFonts: false, plugins: [{
      name: 'concurrent-update',
      async resolveNode(target) {
        if (target !== source.firstChild) return
        await new Promise(resolve => setTimeout(resolve, 0))
        node.data = 'Updated application state'
      },
    }] })
    expect(source.firstChild.firstChild).toBe(node)
    expect(node.data).toBe('Updated application state')
  })
  it('keeps the source intact and leaves no measurement host after capture rejection', async () => {
    const source = fixture()
    const before = source.innerHTML
    await expect(snapdom(source, { embedFonts: false, plugins: [{
      name: 'reject-capture', afterClone() { throw new Error('intentional capture rejection') },
    }] })).rejects.toThrow('intentional capture rejection')
    expect(source.innerHTML).toBe(before)
    expect(document.querySelector('[data-snapdom-internal]')).toBeNull()
  })
  it('includes generated pseudo text in the baked width', async () => {
    const style = document.createElement('style')
    style.textContent = '.clamp-prefix::before { content: "PREFIX " }'
    document.body.appendChild(style)
    const source = fixture()
    const target = source.firstElementChild
    target.className = 'clamp-prefix'
    target.style.cssText = 'width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:20px Arial'
    target.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3)
    await snapdom(source, { embedFonts: false, plugins: [{ name: 'measure-prepared-pseudo',
      afterClone({ clone, classCSS }) {
        const host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        const css = document.createElement('style')
        css.textContent = classCSS
        const measured = clone.cloneNode(true)
        shadow.append(css, measured)
        document.body.appendChild(host)
        try {
          const label = measured.firstElementChild
          expect(label.textContent).toContain('PREFIX ')
          expect(label.textContent.endsWith('…')).toBe(true)
          expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
        } finally { host.remove() }
      },
    }] })
  })

})
