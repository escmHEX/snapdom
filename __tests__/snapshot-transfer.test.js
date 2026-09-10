import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapshot, materializeSnapshot, serializeSnapshot, deserializeSnapshot } from '../src/api/snapshot.js'
import { createScheduler } from '../src/utils/scheduler.js'

const cleanup = []
afterEach(() => { vi.restoreAllMocks(); for (const dispose of cleanup.splice(0).reverse()) dispose() })
function fixture() {
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;color:rgb(10,20,30)'
  root.innerHTML = '<!--comment--><input value="markup"><textarea>markup</textarea><select><option>A</option><option>B</option></select><div data-scroll style="width:40px;height:20px;overflow:scroll"><div style="width:120px;height:80px">scroll</div></div><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#example"/></svg><template><b><!--nested-->template</b></template><canvas width="8" height="8"></canvas>'
  document.body.append(root); cleanup.push(() => root.remove())
  root.querySelector('input').value = 'captured'
  root.querySelector('textarea').value = 'captured area'
  root.querySelector('select').value = 'B'
  root.querySelector('[data-scroll]').scrollTop = 31
  const canvas = root.querySelector('canvas'); canvas.getContext('2d').fillStyle = 'red'; canvas.getContext('2d').fillRect(0, 0, 8, 8)
  const value = snapshot(root); cleanup.push(() => value.dispose())
  return { root, value, canvas }
}
function target(viewport) {
  const frame = document.createElement('iframe')
  frame.style.cssText = `position:fixed;left:-100000px;width:${viewport.width}px;height:${viewport.height}px;border:0`
  frame.style.colorScheme = viewport.colorScheme
  document.body.append(frame); cleanup.push(() => frame.remove())
  const doc = frame.contentDocument
  doc.open(); doc.write('<!doctype html><html><head></head><body>original</body></html>'); doc.close()
  return doc
}
const fast = () => createScheduler({ fast: true })

describe('portable acquired snapshots', () => {
  it('round-trips topology, namespaces, frozen forms/scroll and canvas pixels independently', async () => {
    const { root, value, canvas } = fixture()
    const capturedScroll = root.querySelector('[data-scroll]').scrollTop
    const packet = await serializeSnapshot(value, { fast: true }); cleanup.push(() => packet.dispose())
    const ids = [root.querySelector('input'), root.querySelector('textarea'), root.querySelector('select'), root.querySelector('[data-scroll]'), canvas].map(node => packet.nodeId(node))
    const text = packet.payload.sheets.find(sheet => sheet.text?.length)
    if (text) {
      const captured = JSON.stringify(text.text)
      value._state.sheets.find(sheet => sheet.text?.length).text.length = 0
      expect(JSON.stringify(text.text)).toBe(captured)
    }
    root.querySelector('input').value = 'later'; canvas.getContext('2d').clearRect(0, 0, 8, 8)
    value.dispose()
    const payload = structuredClone(packet.payload, { transfer: packet.transferables })
    const transported = await deserializeSnapshot(payload, { fast: true }); cleanup.push(() => transported.dispose())
    expect(transported.element.firstChild.nodeType).toBe(8)
    expect(transported.element.querySelector('template').content.querySelector('b').firstChild.nodeType).toBe(8)
    expect(transported.element.querySelector('use').getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#example')
    const doc = target(transported.viewport), original = doc.documentElement
    let events = 0; doc.defaultView.addEventListener('snapshot-protocol', () => events++)
    const materialized = await materializeSnapshot(transported, { document: doc, scheduler: fast() }); cleanup.push(() => materialized.dispose())
    expect(ids.slice(0, 3).map(id => materialized.nodeFor(id).value)).toEqual(['captured', 'captured area', 'B'])
    expect(materialized.nodeFor(ids[3]).scrollTop).toBe(capturedScroll)
    const copiedCanvas = materialized.nodeFor(ids[4])
    expect([copiedCanvas.getBoundingClientRect().width, copiedCanvas.getBoundingClientRect().height]).toEqual([8, 8])
    expect(Array.from(copiedCanvas.getContext('2d').getImageData(0, 0, 1, 1).data)).toEqual([255, 0, 0, 255])
    materialized.dispose()
    expect(doc.documentElement).toBe(original)
    doc.defaultView.dispatchEvent(new doc.defaultView.Event('snapshot-protocol'))
    expect(events).toBe(1)
  })

  it('rejects a source disposed during cooperative serialization without returning mixed state', async () => {
    const { value } = fixture(), scheduler = fast()
    const run = scheduler.run.bind(scheduler)
    let first = true
    scheduler.run = async (...args) => { const result = await run(...args); if (first) { first = false; value.dispose() } return result }
    await expect(serializeSnapshot(value, { scheduler })).rejects.toThrow('disposed during serialization')
  })

  it('closes bitmaps created before serialization abort and consumes incoming ones on failure', async () => {
    const { value } = fixture(), controller = new AbortController(), original = globalThis.createImageBitmap
    let bitmap
    vi.spyOn(globalThis, 'createImageBitmap').mockImplementation(async (...args) => { bitmap = await original(...args); controller.abort(); return bitmap })
    await expect(serializeSnapshot(value, { fast: true, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(bitmap.width).toBe(0)
    vi.restoreAllMocks()
    const packet = await serializeSnapshot(value, { fast: true }); cleanup.push(() => packet.dispose())
    packet.payload.nodes[1].type = 999
    await expect(deserializeSnapshot(packet.payload, { fast: true })).rejects.toThrow('Unsupported transported node type')
    expect(packet.transferables.every(item => item.width === 0)).toBe(true)
  })

  it('sanitizes event attributes before connection and restores the provided document on abort', async () => {
    const { root, value } = fixture()
    value.element.setAttribute('onclick', 'globalThis.__snapshotExecuted=true')
    const doc = target(value.viewport), original = doc.documentElement
    const materialized = await materializeSnapshot(value, { document: doc, scheduler: fast() })
    expect(materialized.element.hasAttribute('onclick')).toBe(false)
    materialized.element.dispatchEvent(new doc.defaultView.Event('click'))
    expect(doc.defaultView.__snapshotExecuted).toBeUndefined()
    materialized.dispose(); expect(doc.documentElement).toBe(original)
    const second = snapshot(root); cleanup.push(() => second.dispose())
    const controller = new AbortController(), scheduler = fast(), run = scheduler.run.bind(scheduler)
    scheduler.run = async (...args) => { const result = await run(...args); if (doc.documentElement !== original) controller.abort(); return result }
    await expect(materializeSnapshot(second, { document: doc, scheduler, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(doc.documentElement).toBe(original)
  })

  it('rejects incompatible provided document mode before replacing its tree', async () => {
    const { value } = fixture(), doc = target(value.viewport)
    doc.open(); doc.write('<html><body>quirks</body></html>'); doc.close()
    const original = doc.documentElement
    await expect(materializeSnapshot(value, { document: doc, scheduler: fast() })).rejects.toThrow('compatibility mode')
    expect(doc.documentElement).toBe(original)
  })
})

it('freezes adopted CSSOM, cascade, media and disabled state across transfer without adding elements', async () => {
  const before = [...document.adoptedStyleSheets]
  cleanup.push(() => { document.adoptedStyleSheets = before })
  const root = document.createElement('div'); root.id = 'adopted-fixture'
  root.innerHTML = '<style>#adopted-fixture{color:red}</style><span>Frozen</span>'
  document.body.append(root); cleanup.push(() => root.remove())
  const first = new CSSStyleSheet(); first.replaceSync('#adopted-fixture{color:blue}')
  const second = new CSSStyleSheet(); second.replaceSync('#adopted-fixture{color:rgb(1,2,3)} #adopted-fixture > span:last-child{padding-left:13px}')
  const disabled = new CSSStyleSheet({disabled:true}); disabled.replaceSync('#adopted-fixture{color:green}')
  const media = new CSSStyleSheet({media:'not all'}); media.replaceSync('#adopted-fixture{color:yellow}')
  document.adoptedStyleSheets = [...before, first, second, disabled, media]
  const value = snapshot(root); cleanup.push(() => value.dispose())
  second.replaceSync('#adopted-fixture{color:purple}'); document.adoptedStyleSheets = before
  const packet = await serializeSnapshot(value, {fast:true}); cleanup.push(() => packet.dispose())
  const restored = await deserializeSnapshot(packet.payload, {fast:true}); cleanup.push(() => restored.dispose())
  const result = await materializeSnapshot(restored, {fast:true}); cleanup.push(() => result.dispose())
  const doc = result.element.ownerDocument, view = doc.defaultView
  expect(view.getComputedStyle(result.element).color).toBe('rgb(1, 2, 3)')
  expect(view.getComputedStyle(result.element.querySelector('span')).paddingLeft).toBe('13px')
  expect(result.element.children.length).toBe(2)
  expect(doc.adoptedStyleSheets.length).toBe(before.length + 4)
  expect(document.adoptedStyleSheets).toEqual(before)
})
