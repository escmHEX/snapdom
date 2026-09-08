import { idle } from './browser.js'

/** Cooperative processing over frozen input. One pending yield per invocation, no
 * background work after completion. A single item is atomic and may exceed the budget. */
export function createScheduler({ fast = false, budgetMs = 1, signal, schedulerMode = 'idle' } = {}) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new RangeError('budgetMs must be positive')
  if (schedulerMode !== 'idle' && schedulerMode !== 'background') throw new RangeError('Invalid schedulerMode')
  const check = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Capture aborted', 'AbortError')
  }
  const waitFor = (promise, cancel = () => {}) => {
    if (!signal) return promise
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => { signal.removeEventListener('abort', abort); fn(value) }
      const abort = () => { cancel(); finish(reject, signal.reason || new DOMException('Capture aborted', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      promise.then(value => finish(resolve, value), error => finish(reject, error))
      if (signal.aborted) abort()
    })
  }
  let sliceStart = null
  let sliceDeadline = null
  let pendingYield = null
  const yieldTask = () => {
    check()
    if (fast) return Promise.resolve()
    if (pendingYield) return pendingYield
    let cancel = () => {}
    // Capture processing can wait for genuine spare time. A forced timeout would
    // compete with the renderer even when the browser reports no idle budget.
    const pending = schedulerMode === 'background' ? (
      typeof globalThis.scheduler?.postTask === 'function'
        ? globalThis.scheduler.postTask(() => {}, { priority: 'background', signal })
        : new Promise((resolve, reject) => {
          // A private one-shot channel yields a real task without timer clamping.
          // Close both ends before resuming, including cancellation and failures.
          const channel = new MessageChannel()
          cancel = () => { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close() }
          channel.port1.onmessage = () => { cancel(); resolve() }
          try { channel.port2.postMessage(null) } catch (error) { cancel(); reject(error) }
        })
    ) : new Promise(resolve => {
      const resume = deadline => {
        if (deadline && deadline.timeRemaining() <= 0) {
          cancel = idle(resume, { timeout: null })
          return
        }
        resolve(deadline)
      }
      cancel = idle(resume, { timeout: null })
    })
    pendingYield = waitFor(pending, () => cancel()).then(deadline => {
      sliceStart = performance.now()
      sliceDeadline = deadline || null
      pendingYield = null
    }, error => { pendingYield = null; throw error })
    return pendingYield
  }
  const checkpoint = () => {
    check()
    if (fast) return null
    if (pendingYield) return pendingYield
    return sliceStart === null || performance.now() - sliceStart >= budgetMs ||
      (sliceDeadline && sliceDeadline.timeRemaining() <= 0) ? yieldTask() : null
  }
  return {
    check,
    checkpoint,
    yield: yieldTask,
    async run(items, callback) {
      check()
      const results = []
      if (!items.length) return results
      for (let index = 0; index < items.length; index++) {
        // Several callers may share a yield. Recheck after resumption so an
        // earlier continuation cannot spend the slice for all later callers.
        let pause
        while ((pause = checkpoint())) await pause
        const result = callback(items[index], index)
        // Async work owns its input until it settles. Racing abort here would
        // release capture resources while that callback is still using them.
        results.push(result && typeof result.then === 'function' ? await result : result)
        check()
      }
      check()
      return results
    },
  }
}
