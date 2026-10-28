import { getStyle } from '../utils/index.js'
import { viewportFrozenClones } from '../utils/capture.helpers.js'
import { getAutomaticThumbMinimum } from './scrollbarMetrics.js'
import { isFirefox, isSafari } from '../utils/browser.js'
import { nativeScrollbarFallback } from './scrollbarFallback.js'

// Gecko intentionally omits native scrollbars in SVG image documents. iOS
// Firefox uses WebKit and must retain the existing WebKit capture path.
const needsNativeScrollbarFallback = isFirefox() && !isSafari()

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const layoutProperties = [
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-content', 'row-gap', 'column-gap', 'grid-template-columns',
  'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'justify-items', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'direction', 'writing-mode', 'text-align', 'text-indent', 'white-space',
  'column-count', 'column-width', 'column-fill',
]

const scrollbarPaintProperties = ['background-color', 'border-radius', 'border', 'box-shadow']

// SVG images cannot retain DOM scroll offsets. Once the content is translated,
// buttonless authored scrollbar parts must be painted separately in its gutter.
// Gecko uses an explicit approximation of standard scrollbar colors/geometry;
// other engines retain their existing authored-part path.
async function preserveScrollbars(clone, source, cs, inner, capture, options) {
  const gutterX = Math.round(source.offsetWidth - source.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth))
  const gutterY = Math.round(source.offsetHeight - source.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth))
  const fallback = needsNativeScrollbarFallback ? nativeScrollbarFallback(source, cs, gutterX, gutterY) : null
  if (needsNativeScrollbarFallback ? !fallback : ((!gutterX && !gutterY) || cs.scrollbarWidth !== 'auto')) return
  if (!fallback && getStyle(source, '::-webkit-scrollbar-button').display !== 'none') return
  const thumbStyle = fallback?.thumb || getStyle(source, '::-webkit-scrollbar-thumb')
  const trackStyle = fallback?.track || getStyle(source, '::-webkit-scrollbar-track')
  const automaticMinimum = fallback?.minimum || await getAutomaticThumbMinimum(capture, options)
  const makePart = style => {
    const part = clone.ownerDocument.createElement('div')
    part.style.cssText = 'all:initial;display:block;box-sizing:border-box;pointer-events:none;'
    if (fallback) part.style.colorScheme = cs.colorScheme
    for (const property of scrollbarPaintProperties) part.style.setProperty(property, style.getPropertyValue(property))
    return part
  }
  clone.style.display = cs.display.startsWith('inline') ? 'inline-grid' : 'grid'
  clone.style.gridTemplateColumns = `${source.clientWidth}px ${gutterX}px`
  clone.style.gridTemplateRows = `${source.clientHeight}px ${gutterY}px`
  clone.style.gap = '0'
  inner.style.gridArea = '1 / 1'
  // The content needs its own clip now that the outer box also paints the bars.
  const viewport = clone.ownerDocument.createElement('div')
  viewport.style.cssText = 'all:initial;display:block;overflow:hidden;grid-area:1 / 1;'
  inner.replaceWith(viewport)
  viewport.append(inner)
  const appendAxis = (horizontal, thickness) => {
    if (!thickness) return
    const size = horizontal ? source.clientWidth : source.clientHeight
    const total = horizontal ? source.scrollWidth : source.scrollHeight
    const offset = horizontal ? source.scrollLeft : source.scrollTop
    const dimension = horizontal ? 'width' : 'height'
    const authoredSize = parseFloat(thumbStyle.getPropertyValue(dimension))
    const automaticSize = Number.isNaN(authoredSize) ? automaticMinimum[horizontal ? 'x' : 'y'] : authoredSize
    const maximum = parseFloat(thumbStyle.getPropertyValue(`max-${dimension}`))
    const minimum = Math.max(parseFloat(thumbStyle.getPropertyValue(`min-${dimension}`)) || 0,
      Math.min(Number.isNaN(maximum) ? Infinity : maximum, automaticSize))
    const length = Math.min(size, Math.max(minimum, Math.round(size * size / total)))
    const reversed = horizontal ? cs.direction === 'rtl' : cs.flexDirection === 'column-reverse'
    const range = total - size
    const progress = range > 0 ? (reversed ? 1 + offset / range : offset / range) : 0
    const position = Math.max(0, Math.min(1, progress)) * (size - length)
    const start = position > 0 && position < 1 ? 1 : Math.floor(position)
    const track = makePart(trackStyle)
    track.style.gridArea = horizontal ? '2 / 1' : '1 / 2'
    track.style.position = 'relative'
    if (fallback && !(horizontal ? gutterY : gutterX)) {
      // Overlay bars occupy the existing viewport, never shrink its content.
      track.style.gridArea = '1 / 1'
      track.style[horizontal ? 'height' : 'width'] = `${thickness}px`
      track.style[horizontal ? 'alignSelf' : 'justifySelf'] = 'end'
    }
    const thumb = makePart(thumbStyle)
    thumb.style.position = 'absolute'
    thumb.style.width = `${horizontal ? length : thickness}px`
    thumb.style.height = `${horizontal ? thickness : length}px`
    thumb.style.left = `${horizontal ? start : 0}px`
    thumb.style.top = `${horizontal ? 0 : start}px`
    track.append(thumb); clone.append(track)
  }
  appendAxis(false, fallback ? fallback.vertical : gutterX)
  appendAxis(true, fallback ? fallback.horizontal : gutterY)
  if (gutterX && gutterY) {
    const corner = fallback ? makePart(trackStyle) : clone.ownerDocument.createElement('div')
    if (!fallback) {
      // A zero-client-area native scroller paints only its browser-themed corner.
      corner.className = source.className
      corner.style.cssText = `all:initial;display:block;overflow:scroll;width:${gutterX}px;height:${gutterY}px;color-scheme:${cs.colorScheme};`
      for (const property of cs) {
        if (property.startsWith('--')) corner.style.setProperty(property, cs.getPropertyValue(property))
      }
    }
    corner.style.gridArea = '2 / 2'
    clone.append(corner)
  }
}

/** Replace scroll state (not serialized by SVG) without changing the children's
 * formatting context. The inner box is the original padding box; borders and
 * clipping belong to the outer box. Signed offsets also cover RTL/reverse flex. */
export function preserveScrollLayout(clone, source, styleCache, nodeMap, options = {}) {
  if (clone?.nodeType !== 1 || clone.namespaceURI !== HTML_NS) return
  const scrollX = source.scrollLeft
  const scrollY = source.scrollTop
  const cs = styleCache.get(source) || getStyle(source)
  if (!scrollX && !scrollY) {
    const horizontal = cs.overflowX === 'scroll' ||
      (cs.overflowX === 'auto' && source.scrollWidth > source.clientWidth)
    const vertical = cs.overflowY === 'scroll' ||
      (cs.overflowY === 'auto' && source.scrollHeight > source.clientHeight)
    if (!horizontal && !vertical) return
    if (needsNativeScrollbarFallback && cs.scrollbarWidth !== 'none') {
      return translateScrollLayout(clone, source, cs, styleCache, nodeMap, options)
    }
    // Pseudo-element rules retain var() expressions; the normal style snapshot
    // removes custom properties after resolving ordinary declarations.
    for (const property of cs) {
      if (property.startsWith('--')) clone.style.setProperty(property, cs.getPropertyValue(property))
    }
    const gutterX = Math.round(source.offsetWidth - source.clientWidth -
      parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth))
    const gutterY = Math.round(source.offsetHeight - source.clientHeight -
      parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth))
    if (cs.boxSizing === 'content-box') {
      // Computed content widths exclude classic gutters; serializing that used
      // width would subtract the scrollbar a second time and create overflow.
      if (gutterX > 0) clone.style.width = `${parseFloat(cs.width) + gutterX}px`
      if (gutterY > 0) clone.style.height = `${parseFloat(cs.height) + gutterY}px`
    }
    if (gutterX === 0 && gutterY === 0) {
      // A foreignObject can use classic bars even when its source uses overlay
      // bars. Suppress only that zero-gutter case; a measured classic gutter stays.
      clone.style.scrollbarWidth = 'none'
      clone.style.scrollbarGutter = 'auto'
    }
    return
  }

  if (source.localName === 'input') {
    // Input is a void element: an inner translated box cannot survive SVG
    // serialization. Keep its native font/border rendering and shift the text.
    const shift = cs.direction === 'rtl' ? scrollX : -scrollX
    clone.style.textIndent = `calc(${cs.textIndent} + ${shift}px)`
    return
  }

  return translateScrollLayout(clone, source, cs, styleCache, nodeMap, options)
}

function translateScrollLayout(clone, source, cs, styleCache, nodeMap, options) {
  const scrollX = source.scrollLeft
  const scrollY = source.scrollTop
  const inner = clone.ownerDocument.createElement('div')
  inner.style.all = 'unset'
  for (const property of layoutProperties) {
    inner.style.setProperty(property, cs.getPropertyValue(property))
  }
  if (cs.display === 'block' || cs.display === 'inline-block') inner.style.display = 'flow-root'
  inner.style.boxSizing = 'border-box'
  inner.style.width = `${source.clientWidth}px`
  inner.style.height = `${source.clientHeight}px`
  inner.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`
  inner.style.transformOrigin = '0 0'
  // A translated box establishes the padding-box containing block for absolute
  // descendants just as a positioned scrolling source does.
  inner.style.position = cs.position === 'static' ? 'static' : 'relative'
  clone.style.display = cs.display.startsWith('inline') ? 'inline-block' : 'block'
  clone.style.padding = '0'
  clone.style.overflow = 'hidden'
  clone.style.scrollbarWidth = 'none'
  clone.style.scrollbarGutter = 'auto'
  // Gecko's computed content width includes its native gutter; Chromium's
  // excludes it. Preserve the border box without adding Gecko's gutter twice.
  const extraWidth = needsNativeScrollbarFallback ? parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) : source.offsetWidth - source.clientWidth
  const extraHeight = needsNativeScrollbarFallback ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) : source.offsetHeight - source.clientHeight
  // Keep the source border box while moving padding into its scrolling viewport.
  clone.style.boxSizing = 'border-box'
  clone.style.width = cs.boxSizing === 'border-box' ? cs.width :
    `${parseFloat(cs.width) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + extraWidth}px`
  clone.style.height = cs.boxSizing === 'border-box' ? cs.height :
    `${parseFloat(cs.height) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + extraHeight}px`
  const outside = []
  for (const child of clone.querySelectorAll('*')) {
    const original = nodeMap?.get(child)
    const position = original && (styleCache.get(original) || getStyle(original)).position
    // Absolute/fixed boxes with a containing block outside this scroller do not
    // scroll with it. Keep them outside the newly translated containing block.
    if (viewportFrozenClones.has(child) || (original &&
        (position === 'absolute' || position === 'fixed') &&
        !source.contains(original.offsetParent))) outside.push(child)
  }
  for (const child of outside) child.remove()
  while (clone.firstChild) inner.appendChild(clone.firstChild)
  clone.appendChild(inner)
  for (const child of outside) clone.appendChild(child)
  return preserveScrollbars(clone, source, cs, inner, styleCache, options)
}
