import { createScheduler } from '../utils/scheduler.js'

// Transfer only acquisition-owned state. Node records preserve parser-sensitive
// topology and namespaces without serializing or reading the live source DOM.
export async function serializeSnapshot(snapshot, options = {}) {
  const state = snapshot._state
  if (!state) throw new TypeError('Expected an undisposed snapshot')
  const scheduler = options.scheduler || createScheduler(options)
  const ids = new WeakMap(), records = [], queue = [{ node: state.tree, parent: -1 }], transferables = []
  try {
    await scheduler.run(queue, ({ node, parent, templateContent = false }) => {
      const id = records.length
      ids.set(node, id)
      const record = { type: node.nodeType, parent, templateContent }
      if (node.nodeType === 1) {
        record.namespace = node.namespaceURI
        record.name = node.prefix ? `${node.prefix}:${node.localName}` : node.localName
        record.attributes = Array.from(node.attributes, attribute => [attribute.namespaceURI, attribute.name, attribute.value])
      } else if ([3, 4, 7, 8].includes(node.nodeType)) {
        record.text = node.nodeValue
        if (node.nodeType === 7) record.name = node.target
      } else if (node.nodeType !== 11) throw new TypeError(`Unsupported inert node type ${node.nodeType}`)
      records.push(record)
      for (const child of node.childNodes) queue.push({ node: child, parent: id })
      if (node.nodeType === 1 && node.localName === 'template' && node.content) {
        queue.push({ node: node.content, parent: id, templateContent: true })
      }
    })
    const mutable = await scheduler.run(state.records, async record => {
      const { node, bitmap, ...values } = record
      const result = { ...values, node: ids.get(node) }
      if (bitmap) {
        result.canvas = { width: bitmap.width, height: bitmap.height, bitmap: null }
        if (bitmap.width && bitmap.height) {
          const transferred = await createImageBitmap(bitmap)
          transferables.push(transferred)
          scheduler.check()
          result.canvas.bitmap = transferred
        }
      }
      return result
    })
    const sheets = await scheduler.run(state.sheets, async ({ node, text, ...sheet }) => ({ ...sheet, text: text && await copyRules(text, scheduler), node: ids.get(node) }))
    const animations = await scheduler.run(state.animations, ({ node, pseudo, values }) => ({ node: ids.get(node), pseudo, values: Array.from(values) }))
    const copiedIds = await scheduler.run(state.copiedNodes, node => ids.get(node))
    scheduler.check()
    if (snapshot._state !== state) throw new TypeError('Snapshot disposed during serialization')
    const payload = { version: 1, nodes: records, root: ids.get(snapshot.element), copiedIds, records: mutable, sheets, animations,
      customProperties: state.customProperties.map(entry => [...entry]), attribute: state.attribute,
      baseURL: state.baseURL, doctype: state.doctype, viewport: { ...state.viewport }, rect: { ...snapshot.rect } }
    return { payload, transferables,
      nodeId(node) { return snapshot ? ids.get(snapshot.nodeFor(node)) : undefined },
      dispose() { for (const bitmap of transferables) bitmap.close(); transferables.length = 0; snapshot = null } }
  } catch (error) { for (const bitmap of transferables) bitmap.close(); throw error }
}

export async function deserializeSnapshot(payload, options = {}) {
  if (payload.version !== 1) throw new TypeError('Unsupported snapshot transport version')
  const hostDocument = options.document || document
  const scheduler = options.scheduler || createScheduler(options)
  const doc = hostDocument.implementation.createHTMLDocument('')
  const nodes = [], bitmaps = []
  let disposed = false
  const release = () => {
    if (disposed) return
    disposed = true
    for (const canvas of bitmaps) canvas.width = canvas.height = 0
    for (const record of payload.records) record.canvas?.bitmap?.close()
    nodes[0]?.replaceChildren()
    nodes.length = bitmaps.length = 0
  }
  try {
    await scheduler.run(payload.nodes, record => {
      let node
      if (record.templateContent) node = nodes[record.parent].content
      else if (record.type === 1) {
        node = doc.createElementNS(record.namespace, record.name)
        for (const [namespace, name, value] of record.attributes) node.setAttributeNS(namespace, name, value)
      } else if (record.type === 3) node = doc.createTextNode(record.text)
      else if (record.type === 8) node = doc.createComment(record.text)
      else if (record.type === 7) node = doc.createProcessingInstruction(record.name, record.text)
      else if (record.type === 4) node = doc.importNode(doc.implementation.createDocument(null, null).createCDATASection(record.text), false)
      else if (record.type === 11) node = doc.createDocumentFragment()
      else throw new TypeError(`Unsupported transported node type ${record.type}`)
      nodes.push(node)
      if (record.parent >= 0 && !record.templateContent) nodes[record.parent].appendChild(node)
    })
    const records = await scheduler.run(payload.records, ({ node, canvas, ...values }) => {
      const record = { ...values, node: nodes[node] }
      if (canvas) {
        const copy = doc.createElement('canvas')
        bitmaps.push(copy)
        copy.width = canvas.width; copy.height = canvas.height
        if (canvas.bitmap) { copy.getContext('2d').drawImage(canvas.bitmap, 0, 0); canvas.bitmap.close() }
        record.bitmap = copy
      }
      return record
    })
    const copiedNodes = await scheduler.run(payload.copiedIds, id => nodes[id]), copiedSet = new WeakSet(copiedNodes)
    const sheets = await scheduler.run(payload.sheets, ({ node, ...sheet }) => ({ ...sheet, node: nodes[node] }))
    const animations = await scheduler.run(payload.animations, ({ node, values, ...animation }) => ({ ...animation, node: nodes[node], values: new Map(values) }))
    scheduler.check()
    const state = { doc, tree: nodes[0], copiedNodes, records, sheets, animations, customProperties: payload.customProperties,
        attribute: payload.attribute, baseURL: payload.baseURL, doctype: payload.doctype, host: hostDocument.body, viewport: payload.viewport }
    return { [Symbol.for('snapdom.snapshot')]: true, element: nodes[payload.root], viewport: payload.viewport, rect: payload.rect,
      nodeFor(id) { return typeof id === 'number' ? nodes[id] : copiedSet.has(id) ? id : undefined },
      _state: state,
      dispose() { release(); this._state = null }
    }
  } catch (error) { release(); throw error }
}

async function copyRules(rules, scheduler) {
  return scheduler.run(rules, async rule => rule.rules ? { ...rule, rules: await copyRules(rule.rules, scheduler) } : { ...rule })
}
