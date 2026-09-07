import { getStyle } from '../utils/index.js'
import { viewportFrozenClones } from '../utils/capture.helpers.js'

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const layoutProperties = [
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-content', 'row-gap', 'column-gap', 'grid-template-columns',
  'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'justify-items', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'direction', 'writing-mode', 'text-align', 'text-indent', 'white-space',
  'column-count', 'column-width', 'column-fill',
]

/** Replace scroll state (not serialized by SVG) without changing the children's
 * formatting context. The inner box is the original padding box; borders and
 * clipping belong to the outer box. Signed offsets also cover RTL/reverse flex. */
export function preserveScrollLayout(clone, source, styleCache, nodeMap) {
  if (clone?.nodeType !== 1 || clone.namespaceURI !== HTML_NS) return
  const scrollX = source.scrollLeft
  const scrollY = source.scrollTop
  if (!scrollX && !scrollY) return
  const cs = styleCache.get(source) || getStyle(source)

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
  // Keep the source border box while moving padding into its scrolling viewport.
  clone.style.boxSizing = 'border-box'
  clone.style.width = cs.boxSizing === 'border-box' ? cs.width :
    `${parseFloat(cs.width) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`
  clone.style.height = cs.boxSizing === 'border-box' ? cs.height :
    `${parseFloat(cs.height) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)}px`
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
}
