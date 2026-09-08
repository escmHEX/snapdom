import { afterEach, expect, it } from 'vitest'
import { collectFontUsage } from '../src/modules/fonts.js'
import { prepareClone } from '../src/core/prepare.js'

const mounted = []
function mount(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root); mounted.push(root)
  return root
}
afterEach(() => { for (const root of mounted.splice(0)) root.remove() })
async function usage(root) {
  const prepared = await prepareClone(root, { fast: true, cache: 'soft', __session: { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() } })
  const sources = new Set(prepared.nodeMap.values())
  return collectFontUsage(root, element => sources.has(element))
}
it('collects current form values and displayed placeholders instead of stale textarea markup', async () => {
  const root = mount('<input><textarea>\u017d</textarea><input placeholder="\u011e"><input value="A" placeholder="\u0106"><input type="hidden" value="\u0131">')
  root.firstElementChild.value = '\u015f'
  root.querySelector('textarea').value = '\u0141'
  const result = await usage(root)
  for (const text of ['\u015f', '\u0141', '\u011e', 'A']) expect(result.usedCodepoints.has(text.codePointAt(0))).toBe(true)
  for (const text of ['\u017d', '\u0106', '\u0131']) expect(result.usedCodepoints.has(text.codePointAt(0))).toBe(false)
})
it('removes only unmapped hidden text while retaining visible Unicode and host pseudos', async () => {
  const root = mount('<style>.font-visible-pseudo::before{content:"\u0100"}</style><div style="display:none"><span>\u0131\u015f</span></div><span class="font-visible-pseudo">\u4e00\ud83d\ude00</span>')
  const full = collectFontUsage(root), filtered = await usage(root)
  expect(full.usedCodepoints.has(0x131)).toBe(true)
  expect(filtered.usedCodepoints.has(0x131)).toBe(false)
  expect(filtered.usedCodepoints.has(0x15f)).toBe(false)
  for (const codepoint of [0x100, 0x4e00, 0x1f600]) expect(filtered.usedCodepoints.has(codepoint)).toBe(true)
})
it('retains mapped visibility-hidden and transparent content that still participates in layout', async () => {
  const root = mount('<span style="visibility:hidden;font-family:HiddenLayoutFace">\u0101</span><span style="opacity:0;font-family:TransparentLayoutFace">\u0102</span>')
  const result = await usage(root)
  expect(result.usedCodepoints.has(0x101)).toBe(true)
  expect(result.usedCodepoints.has(0x102)).toBe(true)
  expect([...result.required].some(key => key.startsWith('HiddenLayoutFace__'))).toBe(true)
  expect([...result.required].some(key => key.startsWith('TransparentLayoutFace__'))).toBe(true)
})
