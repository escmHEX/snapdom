import { expect, it } from 'vitest'

// This is a classic-script global lexical binding, like an application's linked
// list Node class. It shadows bare Node without replacing the browser property.
it('bundled capture traverses and styles a HUD when the host declares class Node', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  try {
    const doc = frame.contentDocument
    const collision = doc.createElement('script')
    collision.textContent = 'class Node { constructor(value) { this.value = value; } }'
    doc.head.append(collision)
    const script = doc.createElement('script')
    const loaded = new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject })
    script.src = new URL('./fixtures/node-global-collision.bundle.js', import.meta.url).href
    doc.head.append(script)
    await loaded
    const style = doc.createElement('style')
    style.textContent = '.hud-name{color:rgb(12, 34, 56);font-weight:700}'
    doc.head.append(style)
    const root = doc.createElement('section')
    root.innerHTML = '<span class="hud-name">Styled HUD</span><i data-exclude>Excluded</i>'
    doc.body.append(root)
    const session = { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
    const clone = await frame.contentWindow.NodeCollisionCapture.deepClone(root, session, { fast: true, cache: 'soft', exclude: ['[data-exclude]'], excludeMode: 'remove' })
    expect(clone.children.length).toBe(1)
    expect(clone.textContent).toBe('Styled HUD')
    expect(session.nodeMap.size).toBe(2)
    expect(session.styleMap.size).toBe(2)
    expect(session.styleMap.get(clone.firstElementChild)).toContain('color:rgb(12, 34, 56)')
    expect(session.styleMap.get(clone.firstElementChild)).toContain('font-weight:700')
    expect(frame.contentWindow.Node.ELEMENT_NODE).toBe(1)
  } finally { frame.remove() }
})
