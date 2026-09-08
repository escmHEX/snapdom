import { afterEach, expect, it } from 'vitest'
import { captureDOM } from '../src/core/capture.js'
import { createContext } from '../src/core/context.js'
import { cache } from '../src/core/cache.js'

afterEach(() => document.body.replaceChildren())
function fixture() {
  const node = document.createElement('div')
  node.style.cssText = 'width:100px;height:30px'
  node.innerHTML = '<span>Snapshot</span>'
  document.body.append(node)
  return node
}
function options(plugin) {
  return { ...createContext({ cache: 'soft', fast: true, embedFonts: false, compress: false, resolvePicturePlaceholders: false }), plugins: plugin ? [plugin] : [] }
}
for (const fail of [false, true]) {
  it(`releases global soft node ownership after ${fail ? 'failure' : 'success'}`, async () => {
    const node = fixture()
    const opts = options({ name: 'inspect', afterRender() {
      expect(cache.session.nodeMap.size).toBeGreaterThan(0)
      if (fail) throw new Error('intentional failure')
    } })
    const capture = captureDOM(node, opts)
    if (fail) await expect(capture).rejects.toThrow('intentional failure')
    else await capture
    expect(cache.session.nodeMap.size).toBe(0)
    expect(cache.session.nodeMap).not.toBe(opts.__session.nodeMap)
    expect(opts.__session.nodeMap.size).toBeGreaterThan(0)
  })
}
it('finishing an older capture preserves the active newer session', async () => {
  let releaseFirst, enteredFirst, releaseSecond, enteredSecond
  const firstReady = new Promise(resolve => { enteredFirst = resolve })
  const secondReady = new Promise(resolve => { enteredSecond = resolve })
  const firstWait = new Promise(resolve => { releaseFirst = resolve })
  const secondWait = new Promise(resolve => { releaseSecond = resolve })
  const first = captureDOM(fixture(), options({ name: 'first', async afterRender() { enteredFirst(); await firstWait } }))
  await firstReady
  const opts = options({ name: 'second', async afterRender() { enteredSecond(); await secondWait } })
  const second = captureDOM(fixture(), opts)
  await secondReady
  try {
    releaseFirst(); await first
    expect(cache.session.nodeMap).toBe(opts.__session.nodeMap)
    expect(cache.session.nodeMap.size).toBeGreaterThan(0)
  } finally { releaseSecond(); await second }
  expect(cache.session.nodeMap.size).toBe(0)
})
