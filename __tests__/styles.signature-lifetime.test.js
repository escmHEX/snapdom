import { afterEach, expect, it } from 'vitest'
import { inlineAllStyles } from '../src/modules/styles.js'

afterEach(() => document.body.replaceChildren())
function context(cache, shared) {
  return { options: { cache }, persist: { snapshotKeyCache: shared }, session: { styleCache: new WeakMap(), styleMap: new Map(), nodeMap: new Map() } }
}

it('interns soft styles within each capture and leaves shared signatures untouched', async () => {
  const shared = new Map([['existing-capture', 'existing-key']])
  const first = context('soft', shared), second = context('soft', shared)
  const source = document.createElement('div')
  source.style.cssText = 'color:rgb(1,2,3);width:40px'
  document.body.append(source)
  const one = source.cloneNode(), duplicate = source.cloneNode()
  await inlineAllStyles(source, one, first)
  await inlineAllStyles(source, duplicate, first)
  expect(first.session.snapshotKeyCache.size).toBe(1)
  expect(first.session.styleMap.get(one)).toBe(first.session.styleMap.get(duplicate))
  source.style.color = 'rgb(4,5,6)'
  const two = source.cloneNode()
  await inlineAllStyles(source, two, second)
  expect(second.session.snapshotKeyCache).not.toBe(first.session.snapshotKeyCache)
  expect(second.session.styleMap.get(two)).not.toBe(first.session.styleMap.get(one))
  expect([...shared]).toEqual([['existing-capture', 'existing-key']])
})
