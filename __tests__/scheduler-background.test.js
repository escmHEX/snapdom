import { afterEach, expect, it, vi } from 'vitest'
import { createScheduler } from '../src/utils/scheduler.js'
import { createContext } from '../src/core/context.js'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('passes background priority and cancellation to the native scheduler', async () => {
  const controller = new AbortController(), postTask = vi.fn((callback, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }))
  vi.stubGlobal('scheduler', { postTask })
  const work = createScheduler({ schedulerMode: 'background', signal: controller.signal }).run([1], vi.fn())
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' })
  expect(postTask.mock.calls[0][1]).toEqual({ priority: 'background', signal: controller.signal })
  controller.abort(); await rejected
})
it('fallback yields a native task and closes both ports before continuation', async () => {
  vi.stubGlobal('scheduler', undefined)
  const NativeChannel = MessageChannel, closes = []
  vi.stubGlobal('MessageChannel', class {
    constructor() {
      const channel = new NativeChannel()
      for (const port of [channel.port1, channel.port2]) closes.push(vi.spyOn(port, 'close'))
      return channel
    }
  })
  let microtaskRan = false
  const work = createScheduler({ schedulerMode: 'background', budgetMs: 1000 }).run([1, 2], value => {
    expect(microtaskRan).toBe(true)
    expect(closes.every(close => close.mock.calls.length === 1)).toBe(true)
    return value * 2
  })
  queueMicrotask(() => { microtaskRan = true })
  expect(await work).toEqual([2, 4])
})
it('fallback cancellation closes pending ports and never executes the callback', async () => {
  vi.stubGlobal('scheduler', undefined)
  const ports = []
  vi.stubGlobal('MessageChannel', class {
    constructor() {
      this.port1 = { close: vi.fn(), onmessage: null }
      this.port2 = { close: vi.fn(), postMessage: vi.fn() }
      ports.push(this.port1, this.port2)
    }
  })
  const controller = new AbortController(), callback = vi.fn()
  const work = createScheduler({ schedulerMode: 'background', signal: controller.signal }).run([1], callback)
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await rejected
  expect(ports.every(port => port.close.mock.calls.length === 1)).toBe(true)
  expect(ports[0].onmessage).toBeNull()
  expect(callback).not.toHaveBeenCalled()
})
it('preserves background mode through normalization and rejects invalid modes', () => {
  expect(createContext({ schedulerMode: 'background' }).schedulerMode).toBe('background')
  expect(createContext().schedulerMode).toBe('idle')
  expect(() => createScheduler({ schedulerMode: 'other' })).toThrow('schedulerMode')
})
