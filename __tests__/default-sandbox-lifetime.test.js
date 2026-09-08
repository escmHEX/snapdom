import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDOM } from '../src/core/capture.js'
import { createContext } from '../src/core/context.js'
import { cache } from '../src/core/cache.js'
import { getDefaultStyleForTag, precacheCommonTags } from '../src/utils/css.js'

const selector = '[data-snapdom-sandbox]'
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })
function element() {
  const node = document.createElement('div')
  node.style.cssText = 'width:40px;height:20px'
  node.textContent = 'Test'
  document.body.append(node)
  return node
}
function options(plugin) {
  return { ...createContext({ cache: 'soft', fast: false, embedFonts: false, compress: false, resolvePicturePlaceholders: false }), plugins: [plugin] }
}

describe('default style sandbox ownership', () => {
  it('releases defaults after a real capture fails after serialization', async () => {
    cache.defaultStyle.clear(); cache.baseStyle.clear()
    let sawDefaults = false
    await expect(captureDOM(element(), options({ name: 'fail-after-defaults', afterRender() {
      sawDefaults = !!document.querySelector(selector)
      expect(cache.defaultStyle.size).toBeGreaterThan(0)
      throw new Error('after defaults')
    } }))).rejects.toThrow('after defaults')
    expect(sawDefaults).toBe(true)
    expect(document.querySelector(selector)).toBeNull()
  })

  it('rejects scheduled serialization errors and releases initialized defaults', async () => {
    cache.defaultStyle.clear(); cache.baseStyle.clear()
    vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(() => {
      expect(cache.defaultStyle.size).toBeGreaterThan(0)
      throw new Error('serialization failed')
    })
    await expect(captureDOM(element(), options({ name: 'noop' }))).rejects.toThrow('serialization failed')
    expect(document.querySelector(selector)).toBeNull()
  })

  it('retains the shared helper until the last overlapping capture settles', async () => {
    cache.defaultStyle.clear(); cache.baseStyle.clear()
    let entered, finish
    const ready = new Promise(resolve => { entered = resolve })
    const waiting = new Promise(resolve => { finish = resolve })
    const first = captureDOM(element(), options({ name: 'hold', async afterRender() { entered(); await waiting } }))
    await ready
    const helper = document.querySelector(selector)
    expect(helper).not.toBeNull()
    try {
      await expect(captureDOM(element(), options({ name: 'fail', afterRender() { throw new Error('second') } }))).rejects.toThrow('second')
      expect(document.querySelector(selector)).toBe(helper)
    } finally { finish(); await first }
    expect(document.querySelector(selector)).toBeNull()
  })

  it('does not remove a user element with the old helper id', async () => {
    const userNode = document.createElement('div')
    userNode.id = 'snapdom-sandbox'
    userNode.style.position = 'absolute'
    document.body.append(userNode)
    await captureDOM(element(), options({ name: 'noop' }))
    expect(userNode.isConnected).toBe(true)
  })

  it('uses one helper for a cold batch and leaves none behind', () => {
    cache.defaultStyle.clear()
    const observer = new MutationObserver(() => {})
    observer.observe(document.body, { childList: true })
    precacheCommonTags()
    const added = observer.takeRecords().flatMap(record => [...record.addedNodes]).filter(node => node.matches?.(selector))
    observer.disconnect()
    expect(added).toHaveLength(1)
    expect(document.querySelector(selector)).toBeNull()
  })

  it('cleans the helper if computed default measurement throws', () => {
    cache.defaultStyle.clear()
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('default read') })
    expect(() => getDefaultStyleForTag('div')).toThrow('default read')
    expect(document.querySelector(selector)).toBeNull()
  })
})
