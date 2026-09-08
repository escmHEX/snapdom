import { afterEach, expect, it } from 'vitest'
import { prepareClone } from '../src/core/prepare.js'
import { generateCSSClasses } from '../src/utils/css.js'
import { createScheduler } from '../src/utils/scheduler.js'
import { toCanvas } from '../src/exporters/toCanvas.js'

const mounted = []
afterEach(() => { for (const node of mounted.splice(0)) node.remove() })
function mount(node) { document.body.append(node); mounted.push(node); return node }

async function computed(clone, css) {
  const frame = mount(document.createElement('iframe'))
  frame.style.cssText = 'width:640px;height:400px;border:0'
  const doc = frame.contentDocument
  const style = doc.createElement('style')
  style.textContent = 'body{margin:0}' + css
  doc.head.append(style)
  const root = doc.importNode(clone, true)
  doc.body.append(root)
  await doc.fonts.ready
  return [root, ...root.querySelectorAll('*')].map(node => {
    const cs = frame.contentWindow.getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return { style: [...cs].map(name => [name, cs.getPropertyValue(name)]), rect: [rect.x, rect.y, rect.width, rect.height] }
  })
}

async function pixels(clone, css) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '640'); svg.setAttribute('height', '400'); svg.setAttribute('viewBox', '0 0 640 400')
  const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject')
  foreign.setAttribute('width', '640'); foreign.setAttribute('height', '400')
  const style = document.createElement('style')
  style.textContent = css
  foreign.append(style, clone.cloneNode(true)); svg.append(foreign)
  const text = new XMLSerializer().serializeToString(svg)
  // Exercise the actual exporter, including WebKit's native paint readiness.
  const canvas = await toCanvas('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text), { dpr: 1, scale: 1 })
  try { return Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) }
  finally { canvas.width = canvas.height = 0 }
}

for (const display of ['flex', 'grid']) {
  it(`normalizes only emitted CSS while preserving RTL ${display}, logical dimensions, transforms and paint`, async () => {
    const root = mount(document.createElement('div'))
    root.style.cssText = `display:${display};direction:rtl;box-sizing:border-box;width:460px;height:210px;padding:12px 17px 9px 15px;border:3px solid #234;background:#efe;gap:11px;align-items:center;grid-template-columns:1fr 2fr;position:relative;font:16px/1.2 sans-serif;`
    const first = document.createElement('div')
    first.textContent = 'RTL content'
    first.style.cssText = 'flex:1 1 90px;min-inline-size:70px;max-inline-size:180px;padding:4px 7px;margin-inline-start:9px;border:2px solid #369;border-inline-end-width:5px!important;border-radius:3px 5px 7px 9px;color:#123;transform:translate(2px,3px) rotate(2deg);transform-origin:25% 75%;box-shadow:1px 2px 3px #777;'
    const second = document.createElement('div')
    second.textContent = 'Vertical text'
    second.style.cssText = 'writing-mode:vertical-rl;inline-size:100px;block-size:45px;padding-block:5px 9px;padding-inline:3px 7px;background:#fc9;border-style:solid;border-color:#753;border-width:1px 2px 3px 4px;opacity:0.85;'
    root.append(first, second)
    const session = { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
    const scheduler = createScheduler({ budgetMs: 1 })
    const prepared = await prepareClone(root, { __session: session, __scheduler: scheduler })
    const entries = [...session.styleMap]
    const originalCSS = [...generateCSSClasses(session.styleMap)].map(([key, name]) => `.${name}{${key}}`).join('')
    expect(prepared.classCSS.length).toBeLessThan(originalCSS.length)
    expect([...session.styleMap]).toEqual(entries)
    expect(await computed(prepared.clone, prepared.classCSS)).toEqual(await computed(prepared.clone, originalCSS))
    expect(await pixels(prepared.clone, prepared.classCSS)).toEqual(await pixels(prepared.clone, originalCSS))
  })
}
