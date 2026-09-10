import { createScheduler } from '../utils/scheduler.js'

const SNAPSHOT = Symbol.for('snapdom.snapshot')
const STATES = ['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'target']
const UNSUPPORTED_CONTENT = new Set(['iframe', 'object', 'embed', 'video'])
let sequence = 0

function cssUnescape(value) {
  return value.replace(/\\([\da-f]{1,6}\s?|\r\n|[^\r\n])/gi, (_, escaped) => {
    const hex = escaped.match(/^[\da-f]{1,6}\s?$/i)
    return hex ? String.fromCodePoint(parseInt(escaped.trim(), 16) || 0xfffd) : escaped === '\r\n' ? '' : escaped
  })
}

// CSSOM has already parsed the stylesheet. Only URL tokens are rebased here;
// quoted strings and escapes must remain opaque (notably content: "url(...)").
function absoluteUrls(text, base) {
  let result = '', index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"' || character === "'") {
      const start = index++, quote = character
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue }
        if (text[index++] === quote) break
      }
      result += text.slice(start, index)
    } else if (text.slice(index, index + 4).toLowerCase() === 'url(' && !/[\w-]/.test(text[index - 1] || '')) {
      index += 4
      while (/\s/.test(text[index] || '') && index < text.length) index++
      const quote = text[index] === '"' || text[index] === "'" ? text[index++] : null
      let value = ''
      while (index < text.length) {
        if (text[index] === '\\') { value += text.slice(index, index + 2); index += 2; continue }
        if (quote ? text[index] === quote : text[index] === ')') break
        value += text[index++]
      }
      if (quote) index++
      while (index < text.length && text[index] !== ')') index++
      index++
      result += `url(${JSON.stringify(new URL(cssUnescape(value.trim()), base).href)})`
    } else { result += character; index++ }
  }
  return result
}

function freezeSheet(sheet, base) {
  let rules
  try { rules = sheet.cssRules } catch { throw new Error(`Cannot snapshot inaccessible stylesheet: ${sheet.href || base}`) }
  const result = []
  for (const rule of rules) {
    if (rule.type === 3) {
      if (!rule.styleSheet) throw new Error(`Stylesheet import is not loaded: ${rule.href}`)
      const imported = { rules: freezeSheet(rule.styleSheet, rule.href), prefix: '', suffix: '' }
      for (const wrapper of [rule.media.mediaText && `@media ${rule.media.mediaText}`,
        rule.supportsText && `@supports (${rule.supportsText})`,
        rule.layerName !== null && rule.layerName !== undefined && `@layer ${rule.layerName}`]) {
        if (wrapper) { imported.prefix = `${wrapper}{${imported.prefix}`; imported.suffix += '}' }
      }
      result.push(imported)
    } else result.push({ text: rule.cssText, base })
  }
  return result
}

// URL rebasing needs only frozen rule text and its captured base. Keep this
// transformation out of acquisition and yield between rules during processing.
async function resolveFrozenSheet(rules, scheduler) {
  const text = []
  await scheduler.run(rules, rule => {
    if (!rule.rules) { text.push(absoluteUrls(rule.text, rule.base)); return }
    return resolveFrozenSheet(rule.rules, scheduler).then(imported => text.push(`${rule.prefix}${imported}${rule.suffix}`))
  })
  return text.join('\n')
}

// Rewrite only pseudo-class tokens, including those nested in :is/:not/:has.
// Attribute strings, escaped identifiers and quoted functional arguments are opaque.
function freezeSelector(selector, attribute) {
  let result = '', index = 0, bracketDepth = 0
  while (index < selector.length) {
    const character = selector[index]
    if (character === '\\') { result += selector.slice(index, index + 2); index += 2; continue }
    if (character === '"' || character === "'") {
      const start = index++, quote = character
      while (index < selector.length) {
        if (selector[index] === '\\') { index += 2; continue }
        if (selector[index++] === quote) break
      }
      result += selector.slice(start, index); continue
    }
    if (character === '[') {
      bracketDepth++
      // Frozen inline values must not change original [style] predicates.
      // CSSOM normalized the selector; decode only its attribute-name token.
      const name = selector.slice(index + 1).match(/^(\s*(?:\*?\|)?)((?:\\[\da-f]{1,6}\s?|\\.|[\w-])+)/i)
      const decoded = name && cssUnescape(name[2]).toLowerCase()
      if (decoded === 'style' || decoded === 'href') {
        result += `[${name[1]}${attribute}-${decoded}`; index += name[0].length + 1; continue
      }
    }
    if (character === ']') bracketDepth--
    if (character === ':' && !bracketDepth && selector[index - 1] !== ':') {
      const token = selector.slice(index + 1).match(/^[a-z-]+/i)?.[0]
      if (STATES.includes(token?.toLowerCase()) && !/[\w\\\u0080-\uffff-]/.test(selector[index + 1 + token.length] || '')) {
        result += `[${attribute}~="${token.toLowerCase()}"]`; index += token.length + 1; continue
      }
    }
    result += character; index++
  }
  return result
}

async function rewriteSheet(sheet, attribute, scheduler) {
  await scheduler.run(Array.from(sheet.cssRules), async rule => {
    if (rule.selectorText) rule.selectorText = freezeSelector(rule.selectorText, attribute)
    if (rule.cssRules) await rewriteSheet(rule, attribute, scheduler)
    if (rule.styleSheet) await rewriteSheet(rule.styleSheet, attribute, scheduler)
  })
}

function abortError(signal) { return signal?.reason || new DOMException('Snapshot materialization aborted', 'AbortError') }

function sanitizeCopiedNode(copy) {
  const tag = copy.localName
  for (const name of copy.getAttributeNames()) if (name.toLowerCase().startsWith('on')) copy.removeAttribute(name)
  if (tag === 'script') { copy.setAttribute('type', 'application/x-snapdom-inert'); copy.removeAttribute('src'); copy.textContent = '' }
  if (tag === 'iframe') { copy.removeAttribute('src'); copy.removeAttribute('srcdoc'); copy.setAttribute('sandbox', '') }
  if (tag === 'object' || tag === 'embed') for (const name of ['src', 'data', 'codebase', 'classid']) copy.removeAttribute(name)
  if (tag === 'video' || tag === 'audio' || tag === 'source') { copy.removeAttribute('src'); copy.removeAttribute('srcset'); copy.removeAttribute('autoplay') }
  if (tag === 'meta' && copy.getAttribute('http-equiv')) copy.removeAttribute('http-equiv')
  if (tag === 'link' && copy.rel !== 'stylesheet') copy.removeAttribute('href')
}

export function isSnapshot(value) { return value?.[SNAPSHOT] === true }

/** Copies click-time structure and mutable state without mounting a measurement
 * tree or awaiting resources. An explicitly immutable stylesheet URL is a caller
 * promise: its versioned response and CSSOM will not change before materialization.
 */
export function snapshot(element, options = {}) {
  if (!element || element.nodeType !== 1 || !element.isConnected) throw new TypeError('Expected a connected Element')
  const owner = element.ownerDocument, view = owner.defaultView
  if (!view || owner.documentElement.localName !== 'html') throw new Error('Only connected HTML documents are supported')
  if (owner.fonts?.status === 'loading') {
    const error = new Error('pendingFonts: click-time font resources are still loading')
    error.name = 'SnapshotPendingFontsError'
    error.code = 'SNAPSHOT_PENDING_FONTS'
    throw error
  }
  const immutable = new Set(options.immutableStyleSheets || [])
  const excluded = options.exclude || []
  if (excluded.some(selector => typeof selector !== 'string')) throw new TypeError('Snapshot exclusions must be CSS selectors')
  const excludedSelector = excluded.join(',')
  const doc = owner.implementation.createHTMLDocument('')
  // The copied HTML tree retains its ancestry without becoming this inert
  // document's root. Only materialization needs document-level selectors/layout.
  const tree = doc.importNode(owner.documentElement, true)
  const sourceNodes = [owner.documentElement, ...owner.documentElement.querySelectorAll('*')]
  const copiedNodes = [tree, ...tree.querySelectorAll('*')]
  let copies = new WeakMap(), copiedSet = new WeakSet(copiedNodes)
  for (let index = 0; index < sourceNodes.length; index++) copies.set(sourceNodes[index], copiedNodes[index])
  const root = copies.get(element), rootRect = element.getBoundingClientRect().toJSON()
  const records = [], sheets = [], animations = [], bitmaps = [], customProperties = [], attribute = `data-snapdom-state-${++sequence}`
  const baseURL = owner.baseURI
  const doctype = owner.doctype ? new view.XMLSerializer().serializeToString(owner.doctype) : ''
  const release = () => {
    for (const bitmap of bitmaps) bitmap.width = bitmap.height = 0
    records.length = sheets.length = animations.length = copiedNodes.length = bitmaps.length = customProperties.length = 0
    copies = new WeakMap(); copiedSet = new WeakSet()
    root.remove(); root.replaceChildren(); tree.replaceChildren()
  }
  try {
    // Computed custom properties substitute env() before inheritance. Preserve
    // those root values while resources/layout wait; direct env() declarations
    // on descendants still use the browser environment during materialization.
    const computedRoot = view.getComputedStyle(element)
    // CSSOM appends custom properties after longhands, so only visit that tail:
    // https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle
    for (let index = computedRoot.length - 1; index >= 0; index--) {
      const name = computedRoot[index]
      if (!name.startsWith('--')) break
      const value = computedRoot.getPropertyValue(name)
      // Empty values would remove an existing invalid declaration. URL tokens
      // must retain the base of their stylesheet instead of becoming inline.
      if (value && !/url\(/i.test(value)) customProperties.push([name, value])
    }
    for (const sheet of owner.styleSheets) {
      const node = copies.get(sheet.ownerNode)
      if (!node) throw new Error('A stylesheet without a document owner requires adoptedStyleSheets support')
      const href = sheet.href && new URL(sheet.href, baseURL).href
      sheets.push({ node, href: href && immutable.has(href) ? href : null,
        text: href && immutable.has(href) ? null : freezeSheet(sheet, href || baseURL),
        media: sheet.media.mediaText, disabled: sheet.disabled })
    }
    // Constructed sheets cascade after document sheets without adding DOM nodes.
    // Freeze their CSSOM now; neither later edits nor removal may alter the capture.
    for (const sheet of owner.adoptedStyleSheets || []) {
      sheets.push({ adopted: true, text: freezeSheet(sheet, sheet.href || baseURL),
        media: sheet.media.mediaText, disabled: sheet.disabled })
    }
    for (let index = 0; index < sourceNodes.length; index++) {
      const source = sourceNodes[index], copy = copiedNodes[index]
      const inRoot = source === element || element.contains(source)
      const tag = source.localName
      const shadowRoot = inRoot && source.shadowRoot
      const unsupported = inRoot && UNSUPPORTED_CONTENT.has(tag)
      // Exclusions affect media acquisition and unsupported-content validation;
      // ordinary nodes need no selector walk through their ancestors.
      const skip = inRoot && (shadowRoot || unsupported || tag === 'img' || tag === 'canvas') && excludedSelector && source.closest(excludedSelector)
      if (shadowRoot && !skip) throw new Error('Shadow roots are not supported by structural snapshots')
      if (unsupported && !skip) throw new Error(`Unsupported snapshot content: ${tag}`)
      const record = { node: copy, left: source.scrollLeft, top: source.scrollTop }
      if (tag === 'input') { record.value = source.value; record.checked = source.checked; record.indeterminate = source.indeterminate }
      if (tag === 'textarea' || tag === 'select') record.value = source.value
      if (tag === 'option') record.selected = source.selected
      if (tag === 'img') {
        copy.removeAttribute('srcset'); copy.removeAttribute('sizes')
        if (!inRoot || skip) {
          // Siblings preserve layout and selector topology, not unrelated resource
          // work. Frozen intrinsic dimensions keep their containing blocks stable.
          copy.removeAttribute('src')
          copy.width = source.width; copy.height = source.height
        } else {
          copy.setAttribute('src', source.currentSrc || source.src)
          copy.removeAttribute('loading')
        }
        if (inRoot && !skip && !(source.complete && source.naturalWidth)) {
          // A pending resource must not become newly visible during deferred work.
          copy.removeAttribute('src'); copy.width = source.width; copy.height = source.height
          record.hidden = true
        }
      }
      if (tag === 'canvas' && inRoot && !skip) {
        record.bitmap = doc.createElement('canvas')
        // Register the backing store before any operation that can throw, including
        // drawImage, so acquisition failures have the same cleanup as disposal.
        bitmaps.push(record.bitmap)
        record.bitmap.width = source.width; record.bitmap.height = source.height
        if (source.width && source.height) record.bitmap.getContext('2d').drawImage(source, 0, 0)
      }
      if (record.left || record.top || 'value' in record || 'selected' in record || record.bitmap || record.hidden) records.push(record)
    }
    for (const state of STATES) {
      for (const source of owner.querySelectorAll(`:${state}`)) {
        const copy = copies.get(source)
        copy.setAttribute(attribute, `${copy.getAttribute(attribute) || ''} ${state}`.trim())
      }
    }
    const animated = new Map()
    for (const animation of owner.getAnimations()) {
      const effect = animation.effect, source = effect?.target
      if (!source || !copies.has(source)) continue
      const pseudo = effect.pseudoElement || null
      // Several effects/keyframes can share the same computed value. Index by
      // target identity instead of scanning the document for every animation.
      let pseudos = animated.get(source)
      if (!pseudos) { pseudos = new Map(); animated.set(source, pseudos) }
      let entry = pseudos.get(pseudo)
      if (!entry) {
        entry = { node: copies.get(source), pseudo, values: new Map() }
        pseudos.set(pseudo, entry); animations.push(entry)
      }
      let computed
      for (const frame of effect.getKeyframes()) for (const name of Object.keys(frame)) {
        if (['offset', 'computedOffset', 'easing', 'composite'].includes(name)) continue
        const property = name.startsWith('--') ? name : name.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
        if (entry.values.has(property)) continue
        computed ||= view.getComputedStyle(source, pseudo)
        entry.values.set(property, computed.getPropertyValue(property))
      }
    }
    const host = owner.body || owner.documentElement
    const viewport = { width: view.innerWidth, height: view.innerHeight, scrollX: view.scrollX, scrollY: view.scrollY,
      colorScheme: view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }
    let disposed = false
    return { [SNAPSHOT]: true, element: root, viewport, rect: rootRect,
      nodeFor(node) { return copiedSet.has(node) ? node : copies.get(node) },
      _state: { doc, tree, copiedNodes, records, sheets, animations, customProperties, attribute, baseURL, doctype, host, viewport },
      dispose() {
        if (disposed) return
        disposed = true
        release(); this._state = null
      } }
  } catch (error) { release(); throw error }
}

async function waitForResources(doc, timeout, signal, scheduler) {
  // WebKit can expose a loaded stylesheet without dispatching its load event in
  // a script-disabled sandbox. Yield while observing only this copied document.
  let links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).filter(node => !node.disabled && node.media !== 'not all' && !node.sheet)
  const started = performance.now()
  while (links.length) {
    if (performance.now() - started >= timeout) throw new Error('Snapshot stylesheet resource timeout')
    await scheduler.yield()
    links = links.filter(node => !node.sheet)
  }
  return new Promise((resolve, reject) => {
    const cleanups = []
    const pendingNodes = new Set()
    const finish = error => { for (const cleanup of cleanups) cleanup(); error ? reject(error) : resolve() }
    const timer = setTimeout(() => finish(new Error(`Snapshot resources did not finish within the resource timeout (${Array.from(pendingNodes, node => `${node.localName}#${node.id}`).join(', ') || 'fonts'})`)), timeout)
    cleanups.push(() => clearTimeout(timer))
    const aborted = () => finish(abortError(signal))
    signal?.addEventListener('abort', aborted, { once: true })
    cleanups.push(() => signal?.removeEventListener('abort', aborted))
    if (signal?.aborted) return aborted()
    const pending = []
    for (const node of doc.querySelectorAll('img')) {
      // WebKit keeps a source-less image incomplete without ever dispatching a
      // resource event. Captured pending-image placeholders intentionally have none.
      if (node.localName === 'img' && !node.getAttribute('src') && !node.getAttribute('srcset')) continue
      if (node.complete) continue
      pendingNodes.add(node)
      pending.push(new Promise((done, fail) => {
        const loaded = () => { pendingNodes.delete(node); done() }
        const failed = () => { pendingNodes.delete(node); fail(new Error(`Snapshot resource failed: ${node.href || node.src}`)) }
        node.addEventListener('load', loaded, { once: true }); node.addEventListener('error', failed, { once: true })
        cleanups.push(() => { node.removeEventListener('load', loaded); node.removeEventListener('error', failed) })
      }))
    }
    Promise.all(pending).then(() => doc.fonts.ready).then(() => finish(), finish)
  })
}

async function rewriteMaterializedSheets(doc, attribute, timeout, signal, scheduler) {
  for (const sheet of [...doc.styleSheets, ...doc.adoptedStyleSheets]) {
    try { await rewriteSheet(sheet, attribute, scheduler); continue } catch (error) {
      if (error.name !== 'SecurityError' || !sheet.href || !sheet.ownerNode) throw error
    }
    // Cross-origin link CSSOM is opaque even when the versioned response allows
    // CORS. Fetching that explicitly immutable response is deferred work only.
    const controller = new AbortController(), abort = () => controller.abort(abortError(signal))
    const timer = setTimeout(() => controller.abort(new Error('Snapshot stylesheet resource timeout')), timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      const response = await fetch(sheet.href, { signal: controller.signal })
      if (!response.ok) throw new Error(`Snapshot stylesheet failed: ${response.status} ${sheet.href}`)
      const replacement = sheet.ownerNode.cloneNode(false)
      replacement.media = sheet.media.mediaText
      replacement.removeAttribute('integrity')
      replacement.href = `data:text/css;charset=utf-8,${encodeURIComponent(absoluteUrls(await response.text(), sheet.href))}`
      sheet.ownerNode.replaceWith(replacement)
      await waitForResources(doc, timeout, signal, scheduler)
      if (Array.from(replacement.sheet.cssRules).some(rule => rule.type === 3)) throw new Error('Cross-origin immutable stylesheets with imports require a captured accessible stylesheet')
      await rewriteSheet(replacement.sheet, attribute, scheduler)
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
}

/** Resolves layout only in a sandbox copied from the captured document. No source
 * node is read here; nodeFor accepts either acquisition copies or original keys.
 */
export async function materializeSnapshot(value, options = {}) {
  if (!isSnapshot(value) || !value._state) throw new TypeError('Expected an undisposed snapshot')
  const { signal, resourceTimeoutMs = 5000 } = options
  const scheduler = options.scheduler || createScheduler(options)
  if (signal?.aborted) throw abortError(signal)
  await scheduler.yield()
  if (signal?.aborted) throw abortError(signal)
  const state = value._state
  // Attribute sanitation depends only on the inert copy. Do it cooperatively
  // before creating any browsing context, keeping this work out of acquisition.
  await scheduler.run(state.copiedNodes, node => {
    for (const name of ['style', 'href']) {
      const original = node.getAttribute(name)
      if (original !== null) node.setAttribute(`${state.attribute}-${name}`, original)
    }
    sanitizeCopiedNode(node)
  })
  const providedDocument = options.document
  const originalAdoptedSheets = providedDocument ? [...providedDocument.adoptedStyleSheets] : null
  const originalTree = providedDocument?.documentElement
  if (providedDocument) {
    if (!providedDocument.defaultView || !originalTree?.isConnected) throw new TypeError('Expected a connected provided document')
    const mode = new providedDocument.defaultView.DOMParser().parseFromString(`${state.doctype}<html></html>`, 'text/html').compatMode
    if (providedDocument.compatMode !== mode) throw new Error('Provided document compatibility mode differs from the snapshot')
  }
  const frame = providedDocument ? null : state.doc.createElement('iframe')
  if (frame) {
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('tabindex', '-1')
  frame.setAttribute('data-snapdom-sandbox', '')
  // Avoid laying out the copied document before its final frozen selectors exist.
  frame.style.cssText = `display:none;position:fixed;left:-100000px;top:0;width:${state.viewport.width}px;height:${state.viewport.height}px;border:0;pointer-events:none;`
  frame.style.colorScheme = state.viewport.colorScheme
  }
  let disposed = false
  let materializedTree = null
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (frame) frame.remove()
    else if (materializedTree) {
      providedDocument.adoptedStyleSheets = originalAdoptedSheets
      if (materializedTree.parentNode === providedDocument) providedDocument.replaceChild(originalTree, materializedTree)
      materializedTree.replaceChildren()
    }
  }
  try {
    if (frame) state.host.appendChild(frame)
    const doc = providedDocument || frame.contentDocument
    if (!doc) throw new Error('Unable to create a same-origin snapshot sandbox')
    // Compatibility mode is chosen by the parser, not by inserting a doctype
    // node after the fact. Closing the inert skeleton also settles WebKit's
    // initial about:blank document before waiting for its FontFaceSet.
    // A supplied isolated document already hosts the caller's protocol. Opening
    // it would erase its event listeners; replace only its sanitized HTML tree.
    if (!providedDocument) { doc.open(); doc.write(`${state.doctype}<html><head></head><body></body></html>`); doc.close() }
    const tree = doc.importNode(state.tree, true)
    materializedTree = tree
    const nodes = [tree, ...tree.querySelectorAll('*')], copies = new WeakMap()
    await scheduler.run(state.copiedNodes, (node, index) => copies.set(node, nodes[index]))
    const root = copies.get(value.element)
    await scheduler.run(state.customProperties, ([name, entry]) => root.style.setProperty(name, entry, 'important'))
    const head = tree.querySelector('head')
    for (const base of tree.querySelectorAll('base')) base.remove()
    const base = doc.createElement('base'); base.href = state.baseURL; head.prepend(base)
    const adoptedSheets = []
    await scheduler.run(state.sheets, async sheet => {
      if (sheet.adopted) {
        const adopted = new doc.defaultView.CSSStyleSheet({ media: sheet.media, disabled: sheet.disabled })
        adopted.replaceSync(await resolveFrozenSheet(sheet.text, scheduler))
        adoptedSheets.push(adopted)
        return
      }
      const original = copies.get(sheet.node)
      const node = original.cloneNode(false)
      if (sheet.href) { node.rel = 'stylesheet'; node.href = sheet.href }
      else {
        const text = await resolveFrozenSheet(sheet.text, scheduler)
        if (node.localName === 'link') {
          node.removeAttribute('integrity')
          node.href = `data:text/css;charset=utf-8,${encodeURIComponent(text)}`
        } else node.textContent = text
      }
      node.media = sheet.disabled ? 'not all' : sheet.media
      original.replaceWith(node)
      copies.set(sheet.node, node)
    })
    doc.adoptedStyleSheets = adoptedSheets
    await scheduler.run(state.records, record => {
      const node = copies.get(record.node)
      for (const property of ['value', 'checked', 'indeterminate', 'selected']) if (property in record) node[property] = record[property]
      if (record.hidden) node.style.setProperty('visibility', 'hidden', 'important')
      if (record.bitmap) {
        if (node.localName === 'img') node.src = record.bitmap.toDataURL()
        else if (record.bitmap.width && record.bitmap.height) node.getContext('2d').drawImage(record.bitmap, 0, 0)
      }
    })
    const frozen = doc.createElement('style')
    let css = '*,*::before,*::after{animation:none!important;transition:none!important;}'
    await scheduler.run(state.animations, (animation, index) => {
      const node = copies.get(animation.node)
      if (!animation.pseudo) for (const [property, entry] of animation.values) node.style.setProperty(property, entry, 'important')
      else {
        const marker = `${state.attribute}-animation`
        node.setAttribute(marker, `${node.getAttribute(marker) || ''} ${index}`.trim())
        const style = doc.createElement('span').style
        for (const [property, entry] of animation.values) style.setProperty(property, entry, 'important')
        css += `[${marker}~="${index}"]${animation.pseudo}{${style.cssText}}`
      }
    })
    frozen.textContent = css; head.appendChild(frozen)
    doc.replaceChild(tree, doc.documentElement)
    await waitForResources(doc, resourceTimeoutMs, signal, scheduler)
    await rewriteMaterializedSheets(doc, state.attribute, resourceTimeoutMs, signal, scheduler)
    // Frozen interactive selectors can select a font not used before rewriting.
    if (frame) frame.style.removeProperty('display')
    tree.getBoundingClientRect()
    await waitForResources(doc, resourceTimeoutMs, signal, scheduler)
    await scheduler.run(state.records, record => { const node = copies.get(record.node); node.scrollLeft = record.left; node.scrollTop = record.top })
    doc.defaultView.scrollTo(state.viewport.scrollX, state.viewport.scrollY)
    if (signal?.aborted) throw abortError(signal)
    return { element: copies.get(value.element),
      nodeFor(node) { return copies.get(value.nodeFor(node)) }, dispose }
  } catch (error) { dispose(); throw error }
}
