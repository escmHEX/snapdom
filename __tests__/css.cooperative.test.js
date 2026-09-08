import { afterEach, expect, it } from 'vitest'
import { cache } from '../src/core/cache.js'
import { generateDedupedBaseCSS, generateDedupedBaseCSSCooperative } from '../src/utils/css.js'
import { collectScrollbarCSS, collectScrollbarCSSCooperative } from '../src/utils/capture.helpers.js'

afterEach(() => document.body.replaceChildren())

it('emits byte-identical base resets with a checkpoint between each native tag read', async () => {
  const tags = ['article', 'button', 'div', 'input', 'p', 'span', 'table', 'textarea']
  const expected = generateDedupedBaseCSS(tags)
  for (const tag of tags) cache.defaultStyle.delete(tag)
  let checkpoints = 0
  let resolved = 0
  let resumed = false
  const scheduler = { checkpoint() {
    const next = tags.filter(tag => cache.defaultStyle.has(tag)).length
    expect(next - resolved).toBeLessThanOrEqual(1)
    resolved = next
    checkpoints++
    resumed = !resumed
    return resumed ? Promise.resolve() : null
  } }
  expect(await generateDedupedBaseCSSCooperative(tags, scheduler)).toBe(expected)
  expect(checkpoints).toBeGreaterThanOrEqual(tags.length)
  expect(document.querySelector('[data-snapdom-sandbox]')).toBeNull()
})

it('releases its default-style sandbox when a checkpoint rejects after initialization', async () => {
  cache.defaultStyle.delete('article')
  cache.defaultStyle.delete('p')
  let checks = 0
  const scheduler = { checkpoint() {
    if (++checks === 2) {
      expect(document.querySelector('[data-snapdom-sandbox]')).not.toBeNull()
      return Promise.reject(new DOMException('cancel base CSS', 'AbortError'))
    }
    return null
  } }
  await expect(generateDedupedBaseCSSCooperative(['article', 'p'], scheduler)).rejects.toThrow('cancel base CSS')
  expect(document.querySelector('[data-snapdom-sandbox]')).toBeNull()
})

function scrollbarFixture(onRead = () => {}) {
  const style = (selectorText, cssText) => ({ type:CSSRule.STYLE_RULE, get selectorText() { onRead(); return selectorText }, cssText })
  const thumb = style('.box::-webkit-scrollbar-thumb', '.box::-webkit-scrollbar-thumb { background: red; }')
  const width = style('.box::-webkit-scrollbar', '.box::-webkit-scrollbar { width: 7px; }')
  const ignored = style('.ordinary', '.ordinary { color: blue; }')
  const inaccessible = { href:'https://example.invalid/cross.css', get cssRules() { throw new DOMException('CORS', 'SecurityError') } }
  return { styleSheets:[
    { href:null, cssRules:[ignored, { type:CSSRule.IMPORT_RULE, styleSheet:{ cssRules:[thumb] } },
      { type:CSSRule.MEDIA_RULE, conditionText:'(min-width: 1px)', cssRules:[width, thumb] }, thumb] },
    inaccessible,
  ] }
}

it('preserves import, media, dedupe and inaccessible-sheet output while bounding rule traversal', async () => {
  const expected = collectScrollbarCSS(scrollbarFixture())
  expect(expected).toBe('.box::-webkit-scrollbar-thumb { background: red; }@media (min-width: 1px){.box::-webkit-scrollbar { width: 7px; }}')
  let reads = 0
  let lastReads = 0
  let checks = 0
  let resumed = false
  const actual = await collectScrollbarCSSCooperative(scrollbarFixture(() => reads++), { checkpoint() {
    expect(reads - lastReads).toBeLessThanOrEqual(1)
    lastReads = reads
    checks++
    resumed = !resumed
    return resumed ? Promise.resolve() : null
  } })
  expect(actual).toBe(expected)
  expect(checks).toBeGreaterThan(6)
})

it('propagates cancellation inside nested rules and never memoizes partial CSS', async () => {
  let reads = 0
  const doc = scrollbarFixture(() => reads++)
  const scheduler = { checkpoint() {
    if (reads >= 2) throw new DOMException('cancel nested CSS', 'AbortError')
    return null
  } }
  await expect(collectScrollbarCSSCooperative(doc, scheduler)).rejects.toThrow('cancel nested CSS')
  const interruptedReads = reads
  expect(collectScrollbarCSS(doc)).toBe(collectScrollbarCSS(scrollbarFixture()))
  expect(reads).toBeGreaterThan(interruptedReads)
})

it('keeps the memo fast path and the synchronous helper compatible', async () => {
  let reads = 0
  const doc = scrollbarFixture(() => reads++)
  const expected = collectScrollbarCSS(doc)
  const originalReads = reads
  expect(await collectScrollbarCSSCooperative(doc, { checkpoint:() => null })).toBe(expected)
  expect(reads).toBe(originalReads)
})

it('rechecks a shared slice after resuming before performing either kind of CSS work', async () => {
  cache.defaultStyle.delete('article')
  let checks = 0
  await generateDedupedBaseCSSCooperative(['article'], { checkpoint() {
    checks++
    if (checks <= 3) expect(cache.defaultStyle.has('article')).toBe(false)
    return checks < 3 ? Promise.resolve() : null
  } })
  expect(checks).toBeGreaterThanOrEqual(3)
  let rulesRead = 0
  checks = 0
  const sheet = { href:null, get cssRules() { rulesRead++; return [] } }
  await collectScrollbarCSSCooperative({ styleSheets:[sheet] }, { checkpoint() {
    checks++
    if (checks <= 3) expect(rulesRead).toBe(0)
    return checks < 3 ? Promise.resolve() : null
  } })
  expect(checks).toBeGreaterThanOrEqual(3)
})
