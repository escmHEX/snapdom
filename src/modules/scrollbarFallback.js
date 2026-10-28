// Capture-only approximation: CSS exposes colors and classic gutters, but not
// native thumb minimums, overlay thickness, button geometry or fade state.
// Keep those fallback dimensions here; never alter the source UI or its events.
const overlayThickness = { thin: 8, auto: 12 }

export function nativeScrollbarFallback(source, cs, gutterX, gutterY) {
  if (cs.scrollbarWidth === 'none') return null
  const visible = (overflow, extent, client) => overflow === 'scroll' ||
    (overflow === 'auto' && extent > client)
  const horizontal = visible(cs.overflowX, source.scrollWidth, source.clientWidth)
  const vertical = visible(cs.overflowY, source.scrollHeight, source.clientHeight)
  if (!horizontal && !vertical) return null
  const thickness = overlayThickness[cs.scrollbarWidth] || overlayThickness.auto
  // Computed colors can contain spaces inside rgb()/color(); split only outside.
  const colors = cs.scrollbarColor === 'auto' ? ['GrayText', 'Canvas'] :
    cs.scrollbarColor.split(/\s+(?![^()]*\))/)
  const thumb = source.ownerDocument.createElement('div').style
  const track = source.ownerDocument.createElement('div').style
  thumb.backgroundColor = colors[0]
  thumb.borderRadius = '999px'
  track.backgroundColor = colors[1]
  return {
    thumb, track,
    horizontal: horizontal ? gutterY || thickness : 0,
    vertical: vertical ? gutterX || thickness : 0,
    minimum: { x: 2 * (gutterY || thickness), y: 2 * (gutterX || thickness) },
  }
}
