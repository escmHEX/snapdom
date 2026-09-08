import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScheduler } from '../src/utils/scheduler.js'
import { idleCallback } from '../src/utils/clone.helpers.js'
import { inlineAllStyles } from '../src/modules/styles.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren() })

function idleHarness() {
  const pending = new Map()
  let sequence = 0
  vi.stubGlobal('requestIdleCallback', vi.fn(fn => { pending.set(++sequence, fn); return sequence }))
  vi.stubGlobal('cancelIdleCallback', vi.fn(id => pending.delete(id)))
  return {
    pending,
    flush(deadline = { didTimeout: false, timeRemaining: () => 1000 }) {
      const [id, fn] = pending.entries().next().value
      pending.delete(id)
      fn(deadline)
    },
  }
}

describe('capture processing scheduler lifetime', () => {
  it('uses one yield for a synchronous list without a forced timeout', async () => {
    const h = idleHarness()
    const work = createScheduler({ budgetMs: 1000 }).run([1, 2, 3], value => value * 2)
    expect(h.pending.size).toBe(1)
    expect(window.requestIdleCallback.mock.calls[0][1]).toBeUndefined()
    h.flush()
    expect(await work).toEqual([2, 4, 6])
    expect(h.pending.size).toBe(0)
  })

  it('requeues an exhausted deadline without executing work and cancels the replacement on abort', async () => {
    const h = idleHarness(), controller = new AbortController(), callback = vi.fn()
    const work = createScheduler({ signal: controller.signal }).run([1], callback)
    const rejection = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    h.flush({ didTimeout: true, timeRemaining: () => 0 })
    expect(callback).not.toHaveBeenCalled()
    expect(h.pending.size).toBe(1)
    controller.abort()
    await rejection
    expect(h.pending.size).toBe(0)
  })

  it('yields when the browser deadline expires before the configured budget', async () => {
    const h = idleHarness(), seen = []
    let remaining = 10
    const work = createScheduler({ budgetMs: 1000 }).run([1, 2], value => {
      seen.push(value)
      remaining = 0
      return value
    })
    h.flush({ didTimeout: false, timeRemaining: () => remaining })
    await Promise.resolve(); await Promise.resolve()
    expect(seen).toEqual([1])
    expect(h.pending.size).toBe(1)
    h.flush()
    expect(await work).toEqual([1, 2])
    expect(h.pending.size).toBe(0)
  })

  it('processes synchronous items in one slice without interleaved microtasks', async () => {
    const h = idleHarness(), order = []
    const work = createScheduler({ budgetMs: 1000 }).run([1, 2], value => {
      order.push(value)
      queueMicrotask(() => order.push('microtask'))
      return value
    })
    h.flush()
    await work
    expect(order).toEqual([1, 2, 'microtask', 'microtask'])
  })

  it('rechecks shared deadlines before each caller resumes', async () => {
    const h = idleHarness(), seen = [], scheduler = createScheduler({ budgetMs: 1000 })
    let remaining = 10
    const first = scheduler.run([1], value => { seen.push(value); remaining = 0 })
    const second = scheduler.run([2], value => { seen.push(value) })
    expect(h.pending.size).toBe(1)
    h.flush({ didTimeout: false, timeRemaining: () => remaining })
    await first
    expect(seen).toEqual([1])
    expect(h.pending.size).toBe(1)
    h.flush()
    await second
    expect(seen).toEqual([1, 2])
    expect(h.pending.size).toBe(0)
  })

  it('shares the slice across nested processing without a yield per node', async () => {
    const h = idleHarness()
    const scheduler = createScheduler({ budgetMs: 1000 })
    const work = scheduler.run([1, 2], value => scheduler.run([value], item => item))
    expect(h.pending.size).toBe(1)
    h.flush()
    expect(await work).toEqual([[1], [2]])
    expect(scheduler.checkpoint()).toBeNull()
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(0)
  })

  it('cancels queued idle work and rejects on abort', async () => {
    const h = idleHarness()
    const controller = new AbortController()
    const work = createScheduler({ signal: controller.signal }).run([1, 2], value => value)
    const rejection = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(h.pending.size).toBe(0)
  })

  it('waits for an in-flight asynchronous item before rejecting abort and skips remaining work', async () => {
    const controller = new AbortController()
    let started
    const ready = new Promise(resolve => { started = resolve })
    let finish, settled = false
    const pending = new Promise(resolve => { finish = resolve })
    const callback = vi.fn(() => {
      started()
      return pending
    })
    const work = createScheduler({ fast: true, signal: controller.signal }).run([1, 2], callback)
    work.then(() => { settled = true }, () => { settled = true })
    await ready
    const rejection = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await rejection
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('propagates synchronous and asynchronous item failures', async () => {
    const scheduler = createScheduler({ fast: true })
    await expect(scheduler.run([1], () => { throw new Error('sync') })).rejects.toThrow('sync')
    await expect(idleCallback([1], async () => { throw new Error('async') }, true)).rejects.toThrow('async')
  })

  it('yields to timers on the fallback and between consumed budgets', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    let timerRan = false
    setTimeout(() => { timerRan = true }, 0)
    let boundaries = 0
    await createScheduler({ budgetMs: 1 }).run([1, 2, 3], () => {
      expect(timerRan).toBe(true)
      const end = performance.now() + 2
      while (performance.now() < end) { /* consume one atomic item */ }
      setTimeout(() => { boundaries++ }, 0)
    })
    expect(boundaries).toBeGreaterThanOrEqual(2)
  })
})

describe('soft style cache ownership', () => {
  it('installs no observer or font listener and refreshes styles per session', async () => {
    const observer = vi.fn()
    vi.stubGlobal('MutationObserver', observer)
    const fonts = vi.spyOn(document.fonts, 'addEventListener')
    const source = document.createElement('span')
    source.textContent = 'Snapshot'
    source.style.color = 'red'
    document.body.append(source)
    const session = () => ({ styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() })
    const first = session(), clone1 = source.cloneNode(true)
    await inlineAllStyles(source, clone1, first, { cache: 'soft', embedFonts: false })
    source.style.color = 'blue'
    const second = session(), clone2 = source.cloneNode(true)
    await inlineAllStyles(source, clone2, second, { cache: 'soft', embedFonts: true })
    expect(first.styleMap.get(clone1)).not.toEqual(second.styleMap.get(clone2))
    expect(first.snapshots).not.toBe(second.snapshots)
    expect(observer).not.toHaveBeenCalled()
    expect(fonts).not.toHaveBeenCalled()
  })
})
