import { rasterize } from '../api/rasterize.js'

const metricsByCapture = new WeakMap()
// The browser's automatic thumb minimum is not exposed by CSS and can differ
// from its native scrollbar thickness. Measure its own SVG paint once per
// capture, reusing the existing abortable exporter and releasing the bitmap.
const probe = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="102" height="102">
<foreignObject width="102" height="102"><div xmlns="http://www.w3.org/1999/xhtml">
<style>
div { margin:0;padding:0;border:0;box-sizing:content-box; }
::-webkit-scrollbar { width:1px;height:1px;background:transparent; }
::-webkit-scrollbar-thumb { background:black;border:0;border-radius:0;width:auto;height:auto; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-button { display:none; }
</style>
<div style="position:absolute;left:0;top:0;width:1px;height:100px;overflow-y:scroll;overflow-x:hidden"><div style="height:100000px;width:1px"></div></div>
<div style="position:absolute;left:2px;top:101px;width:100px;height:1px;overflow-x:scroll;overflow-y:hidden"><div style="width:100000px;height:1px"></div></div>
</div></foreignObject></svg>`)

export function getAutomaticThumbMinimum(capture, options) {
  let result = metricsByCapture.get(capture)
  if (!result) {
    result = measure(options)
    metricsByCapture.set(capture, result)
  }
  return result
}

async function measure(options) {
  const canvas = await rasterize(probe, {
    ...options, width:102, height:102, scale:1, dpr:1, backgroundColor:null,
    willReadFrequently:true, crop:undefined, meta:undefined,
  })
  try {
    const ctx = canvas.getContext('2d')
    const vertical = ctx.getImageData(0, 0, 1, 100).data
    const horizontal = ctx.getImageData(2, 101, 100, 1).data
    let x = 0, y = 0
    for (let i = 3; i < vertical.length; i += 4) {
      if (vertical[i] >= 128) y++
      if (horizontal[i] >= 128) x++
    }
    return { x, y }
  } finally { canvas.width = canvas.height = 0 }
}
