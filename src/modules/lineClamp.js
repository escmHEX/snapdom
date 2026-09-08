const snapshots = new WeakMap()
let graphemes

/** Capture only truncation candidates while computed styles and source text agree.
 * CSSStyleDeclaration is live, so retaining it across cloning awaits is not enough.
 * @param {Element} source
 * @param {Element} clone
 * @param {CSSStyleDeclaration} cs
 */
export function snapshotTextTruncation(source, clone, cs) {
  const lines = parseInt(cs.getPropertyValue('-webkit-line-clamp') || cs.getPropertyValue('line-clamp'), 10) || 0
  const single = cs.textOverflow === 'ellipsis' &&
    (cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre') &&
    (cs.overflowX === 'hidden' || cs.overflowX === 'clip')
  if (!(lines > 0 || single) || source.childElementCount > 0) return
  const textNodes = Array.from(source.childNodes).filter(n => n.nodeType === 3)
  if (!textNodes.length || !source.clientWidth) return
  if (!lines && source.scrollWidth <= source.clientWidth + 0.5) return
  const style = source.ownerDocument.createElement('div').style
  for (let i = 0; i < cs.length; i++) {
    const prop = cs[i]
    style.setProperty(prop, cs.getPropertyValue(prop))
  }
  // Preserve the resolved content width, independent of flex/grid/ancestor layout.
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  const border = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
  const width = parseFloat(cs.width)
  style.width = Number.isFinite(width) ? cs.width :
    `${source.clientWidth + (cs.boxSizing === 'border-box' ? border : -pad)}px`
  snapshots.set(clone, { css: style.cssText, text: textNodes.map(n => n.data).join(''), lines, single })
}

/** Bake truncation on capture-owned nodes, using one lazily mounted isolated measurer.
 * Never rewrites source text/styles. The temporary host is outside ordinary
 * capture subtrees; full body/document captures necessarily contain that host.
 * @param {Element} cloneRoot
 * @param {Map<Node, Node>} nodeMap clone to source map for this capture
 */
export async function lineClampTree(cloneRoot, nodeMap, classCSS = '', options = {}) {
  let host
  let shadow
  try {
    for (const clone of nodeMap.keys()) {
      const pause = options.__scheduler?.checkpoint()
      if (pause) await pause
      const snapshot = snapshots.get(clone)
      if (!snapshot || !(clone === cloneRoot || cloneRoot.contains(clone))) continue
      if (!host) {
        const doc = cloneRoot.ownerDocument
        host = doc.createElement('div')
        host.setAttribute('data-snapdom-internal', '')
        host.style.cssText = 'all:initial!important;position:fixed!important;left:-100000px!important;top:0!important;visibility:hidden!important;pointer-events:none!important;'
        shadow = host.attachShadow({ mode: 'open' })
        const styles = doc.createElement('style')
        styles.textContent = classCSS
        shadow.appendChild(styles)
        doc.body.appendChild(host)
      }
      // The prepared clone includes styled pseudo-elements. They consume space
      // alongside text and must participate in the same isolated measurement.
      const measure = clone.cloneNode(true)
      measure.style.cssText = snapshot.css
      // Release height constraints for scrollHeight measurement, keeping the font
      // strut and -webkit-box layout that determine the actual line height (#443).
      for (const [prop, value] of Object.entries({ position: 'static', float: 'none', margin: '0', transform: 'none', zoom: '1', height: 'auto', 'min-height': '0', 'max-height': 'none', 'min-width': '0', 'max-width': 'none', animation: 'none', transition: 'none' })) {
        measure.style.setProperty(prop, value, 'important')
      }
      const textNodes = Array.from(measure.childNodes).filter(node => node.nodeType === 3)
      const write = value => {
        textNodes[0].data = value
        for (let i = 1; i < textNodes.length; i++) textNodes[i].data = ''
      }
      write(snapshot.text)
      shadow.appendChild(measure)
      const cs = measure.style
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      let targetH = Infinity
      if (snapshot.lines > 0) {
        write('X')
        const lineH = measure.scrollHeight - pad
        targetH = Math.round(lineH * snapshot.lines + pad)
        write(snapshot.text)
      }
      const fits = () => measure.scrollHeight <= targetH + 0.5 &&
        (!snapshot.single || measure.scrollWidth <= measure.clientWidth + 0.5)
      let result = snapshot.text
      if (!fits()) {
        const ends = [0]
        if (typeof Intl.Segmenter === 'function') {
          graphemes ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          for (const { index, segment } of graphemes.segment(snapshot.text)) {
            const pause = options.__scheduler?.checkpoint()
            if (pause) await pause
            ends.push(index + segment.length)
          }
        } else {
          // Firefox before 125 has no Segmenter. Keep capture available and never
          // cut a surrogate pair; full grapheme boundaries use the native API.
          for (const point of snapshot.text) {
            const pause = options.__scheduler?.checkpoint()
            if (pause) await pause
            ends.push(ends[ends.length - 1] + point.length)
          }
        }
        let lo = 0, hi = ends.length - 1, best = 0
        while (lo <= hi) {
          const pause = options.__scheduler?.checkpoint()
          if (pause) await pause
          const mid = (lo + hi) >> 1
          write(snapshot.text.slice(0, ends[mid]) + '…')
          if (fits()) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        result = snapshot.text.slice(0, ends[best]) + '…'
      }
      // Preserve any generated pseudo-element children in the output clone.
      let written = false
      for (const node of clone.childNodes) {
        if (node.nodeType !== 3) continue
        node.data = written ? '' : result
        written = true
      }
      measure.remove()
      snapshots.delete(clone)
    }
  } finally {
    host?.remove()
  }
}
