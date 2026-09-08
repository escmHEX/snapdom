import { afterEach, expect, it } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
let link
afterEach(() => link?.remove())
it.each(['', '.icon{color:red}'])('embeds matching faces from accessible data stylesheet CSS %s', async (extraCSS) => {
  link = document.createElement('link')
  link.rel = 'stylesheet'
  const loaded = new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject })
  link.href = 'data:text/css;charset=utf-8,' + encodeURIComponent(extraCSS + '@font-face{font-family:CaptureFixture;src:url(data:font/woff2;base64,AAAA);font-weight:400;font-style:normal}')
  document.head.append(link)
  await loaded
  expect(link.sheet.cssRules.length).toBe(extraCSS ? 2 : 1)
  const css = await embedCustomFonts({ required: new Set(['CaptureFixture__400__normal__100']), usedCodepoints: new Set([65]), cachePolicy: 'soft' })
  expect(css).toContain('@font-face')
  expect(css).toContain('CaptureFixture')
})
