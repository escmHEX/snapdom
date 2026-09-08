import { afterEach, expect, it } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'

afterEach(() => cache.resource.clear())
function inputs(doc, scheduler) {
  return { doc, scheduler, required: new Set(['SnapshotFace__400__normal__100']), usedCodepoints: new Set([65]), localFonts: [{ family: 'SnapshotFace', src: 'data:font/woff2;base64,AA==' }] }
}
it('soft font embedding retains reusable resources without retaining per-document CSS outputs', async () => {
  cache.resource.clear()
  for (let i = 0; i < 12; i++) {
    const doc = document.implementation.createHTMLDocument('')
    const css = await embedCustomFonts(inputs(doc))
    expect(css).toContain('SnapshotFace')
  }
  expect([...cache.resource.keys()].filter(key => key.startsWith('fonts-embed-css::'))).toHaveLength(0)
})
it('font CSSOM traversal uses the capture scheduler without changing font output', async () => {
  const doc = document.implementation.createHTMLDocument('')
  const style = doc.createElement('style')
  style.textContent = Array.from({ length: 80 }, (_, i) => `.rule${i}{color:rgb(${i},0,0)}`).join('')
  doc.head.appendChild(style)
  let checkpoints = 0
  const scheduler = { checkpoint() { checkpoints++; return Promise.resolve() }, check() {} }
  const expected = await embedCustomFonts(inputs(doc))
  const actual = await embedCustomFonts(inputs(doc, scheduler))
  expect(actual).toBe(expected)
  expect(checkpoints).toBeGreaterThanOrEqual(80)
})
