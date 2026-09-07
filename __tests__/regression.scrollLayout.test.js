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
    expect(clone.style.scrollbarWidth).toBe(source.style.scrollbarWidth)
    expect(clone.style.scrollbarGutter).toBe(source.style.scrollbarGutter)
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
})
