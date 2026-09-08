import { afterEach, describe, expect, it } from 'vitest'
import { preserveScrollLayout } from '../src/modules/scroll.js'

const mounts = []
afterEach(() => mounts.splice(0).forEach(node => node.remove()))

function fixture(layout, x, y) {
  const source = document.createElement('div')
  source.style.cssText = `position:relative;width:220px;height:140px;box-sizing:border-box;padding:9px 13px;border:3px solid black;overflow:auto;${layout}`
  for (let i = 0; i < 12; i++) {
    const child = document.createElement('div')
    child.textContent = `item ${i}`
    child.style.cssText = 'flex:none;width:80px;height:35px;background:green'
    source.appendChild(child)
  }
  document.body.appendChild(source)
  mounts.push(source)
  source.scrollLeft = x
  source.scrollTop = y
  return source
}

function cloneFixture(source) {
  const clone = source.cloneNode(true)
  const originals = [source, ...source.querySelectorAll('*')]
  const clones = [clone, ...clone.querySelectorAll('*')]
  const nodeMap = new Map(clones.map((node, i) => [node, originals[i]]))
  preserveScrollLayout(clone, source, new WeakMap(), nodeMap)
  document.body.appendChild(clone)
  mounts.push(clone)
  return clone
}

function assertGeometry(source, clone) {
  const originalRect = source.getBoundingClientRect()
  const cloneRect = clone.getBoundingClientRect()
  const children = clone.firstElementChild.children
  Array.from(source.children).forEach((child, i) => {
    const a = child.getBoundingClientRect()
    const b = children[i].getBoundingClientRect()
    expect(b.left - cloneRect.left).toBeCloseTo(a.left - originalRect.left, 0)
    expect(b.top - cloneRect.top).toBeCloseTo(a.top - originalRect.top, 0)
    expect(b.width).toBeCloseTo(a.width, 0)
    expect(b.height).toBeCloseTo(a.height, 0)
  })
}

describe('serialized scroll layout', () => {
  it.each([
    ['display:flex;flex-direction:column-reverse;gap:4px', 0, -180],
    ['display:flex;flex-direction:column;gap:4px', 0, 180],
    ['display:flex;flex-direction:row;gap:4px', 180, 0],
    ['display:flex;flex-direction:row;direction:rtl;gap:4px', -180, 0],
    ['display:grid;grid-template-columns:80px 80px;gap:4px', 0, 100],
    ['display:block', 0, 180],
  ])('preserves geometry for %s', (layout, x, y) => {
    const source = fixture(layout, x, y)
    const before = source.outerHTML
    const offset = [source.scrollLeft, source.scrollTop]
    expect(Math.abs(offset[0]) + Math.abs(offset[1])).toBeGreaterThan(0)
    assertGeometry(source, cloneFixture(source))
    expect(source.outerHTML).toBe(before)
    expect([source.scrollLeft, source.scrollTop]).toEqual(offset)
  })

  it('preserves an absolute child anchored to the scrolling padding box', () => {
    const source = fixture('display:block', 0, 180)
    source.lastElementChild.style.cssText += ';position:absolute;top:210px;left:30px'
    assertGeometry(source, cloneFixture(source))
  })

  it('does not remove a measured classic scrollbar gutter', () => {
    const source = fixture('scrollbar-gutter:stable', 0, 0)
    const clone = cloneFixture(source)
    const cs = getComputedStyle(source)
    const gutter = source.offsetWidth - source.clientWidth -
      parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
    expect(clone.clientWidth).toBe(source.clientWidth)
    // Overlay engines do not reserve a gutter even with scrollbar-gutter:stable.
    if (gutter > 0) {
      expect(clone.style.scrollbarWidth).toBe(source.style.scrollbarWidth)
      expect(clone.style.scrollbarGutter).toBe(source.style.scrollbarGutter)
    } else expect(clone.style.scrollbarWidth).toBe('none')
  })

  it('retains the inline formatting of inline-flex scrollers', () => {
    const source = fixture('display:inline-flex;flex-direction:column', 0, 180)
    expect(getComputedStyle(cloneFixture(source)).display).toBe('inline-block')
  })

  it.each(['absolute', 'fixed'])('keeps an outside %s containing block outside the translation', position => {
    const source = fixture('position:static', 0, 180)
    const child = source.lastElementChild
    child.style.cssText += `;position:${position};top:40px;left:20px`
    const rect = child.getBoundingClientRect()
    const clone = cloneFixture(source)
    const clonedChild = clone.lastElementChild
    expect(clonedChild.textContent).toBe(child.textContent)
    expect(clonedChild.getBoundingClientRect().top).toBeCloseTo(rect.top, 0)
    expect(clonedChild.getBoundingClientRect().left).toBeCloseTo(rect.left, 0)
  })
  it('keeps zero-gutter scrollports from gaining a classic gutter at rest', () => {
    const source = fixture('display:block', 0, 0)
    source.firstElementChild.style.width = '350px'
    const cs = getComputedStyle(source)
    const vertical = Math.round(source.offsetWidth - source.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth))
    const horizontal = Math.round(source.offsetHeight - source.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth))
    const clone = cloneFixture(source)
    if (vertical === 0 && horizontal === 0) {
      expect(clone.style.scrollbarWidth).toBe('none')
      expect(clone.clientWidth).toBe(source.clientWidth)
      expect(clone.clientHeight).toBe(source.clientHeight)
    } else {
      expect(clone.style.scrollbarWidth).toBe(source.style.scrollbarWidth)
      expect(clone.clientWidth).toBe(source.clientWidth)
    }
    expect(source.scrollTop).toBe(0)
    expect(source.scrollLeft).toBe(0)
  })

  it('does not alter scrollbar styling on boxes that do not overflow', () => {
    const source = fixture('display:block', 0, 0)
    source.replaceChildren(source.firstElementChild)
    const clone = cloneFixture(source)
    expect(clone.style.scrollbarWidth).toBe(source.style.scrollbarWidth)
    expect(clone.style.scrollbarGutter).toBe(source.style.scrollbarGutter)
  })

})

describe('native input scroll serialization', () => {
  for (const direction of ['ltr', 'rtl']) {
    for (const end of [false, true]) {
      it(`preserves ${direction} focused text at the ${end ? 'end' : 'start'}`, () => {
        const input = document.createElement('input')
        input.value = 'ABCDEFGHIJKLMN OPQRSTUVWXYZ 0123456789'
        input.style.cssText = `direction:${direction};box-sizing:border-box;width:180px;height:40px;padding:3px;border:2px solid black;font:20px monospace;text-indent:5px`
        document.body.appendChild(input)
        mounts.push(input)
        input.focus()
        input.setSelectionRange(end ? input.value.length : 0, end ? input.value.length : 0)
        input.scrollLeft = end ? (direction === 'rtl' ? -10000 : 10000) : 0
        const offset = input.scrollLeft
        if (end) expect(Math.abs(offset)).toBeGreaterThan(100)
        const clone = cloneFixture(input)
        expect(clone.childNodes.length).toBe(0) // HTML void elements cannot serialize an inner scroll box.
        expect(clone.value).toBe(input.value)
        expect(clone.getBoundingClientRect().width).toBe(input.getBoundingClientRect().width)
        expect(clone.getBoundingClientRect().height).toBe(input.getBoundingClientRect().height)
        expect(getComputedStyle(clone).padding).toBe('3px')
        expect(getComputedStyle(clone).borderLeftWidth).toBe('2px')
        expect(parseFloat(getComputedStyle(clone).textIndent)).toBeCloseTo(5 + (direction === 'rtl' ? offset : -offset), 4)
        expect(input.scrollLeft).toBe(offset)
        expect(input.style.textIndent).toBe('5px')
      })
    }
  }
})
