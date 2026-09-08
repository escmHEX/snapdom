import { afterEach, expect, it } from 'vitest'
import { collectFontUsage, collectFontUsageCooperative } from '../src/modules/fonts.js'
import { createScheduler } from '../src/utils/scheduler.js'

afterEach(() => document.body.replaceChildren())
it('cooperative collection keeps variants, Unicode and pseudo content', async () => {
  const root = document.createElement('div')
  root.innerHTML = '<style>.font-step::before{content:"XYZ";font-family:serif;font-weight:700}</style><span class="font-step">\u{1f600}\u03a9</span><b>Bold</b>'
  document.body.append(root)
  const expected = collectFontUsage(root)
  let checkpoints = 0
  const scheduler = { checkpoint() { checkpoints++; return Promise.resolve() } }
  const actual = await collectFontUsageCooperative(root, null, scheduler)
  expect(actual).toEqual(expected)
  expect(actual.usedCodepoints.has(0x1f600)).toBe(true)
  expect(actual.usedCodepoints.has(90)).toBe(true)
  expect(checkpoints).toBeGreaterThan(root.children.length)
})
it('cooperative collection propagates cancellation at a traversal boundary', async () => {
  const root = document.createElement('div')
  root.innerHTML = '<span>One</span><span>Two</span>'
  document.body.append(root)
  const controller = new AbortController()
  const scheduler = createScheduler({ signal: controller.signal })
  const result = collectFontUsageCooperative(root, null, scheduler)
  controller.abort(new Error('cancel collection'))
  await expect(result).rejects.toThrow('cancel collection')
  expect(root.textContent).toBe('OneTwo')
})
