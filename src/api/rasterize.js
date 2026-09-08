import { toCanvas } from '../exporters/toCanvas.js'
import { createScheduler } from '../utils/scheduler.js'

/** Rasterize a previously captured URL in the caller's document. This entry
 * reuses the normal exporter, including its browser-specific layout and cleanup. */
export async function rasterize(url, options = {}) {
  const scheduler = createScheduler(options)
  scheduler.check()
  const canvas = await toCanvas(url, {
    scale: 1,
    dpr: globalThis.devicePixelRatio || 1,
    ...options,
    __scheduler: scheduler,
  })
  try {
    scheduler.check()
    return canvas
  } catch (error) {
    canvas.width = canvas.height = 0
    throw error
  }
}
