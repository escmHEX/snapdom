import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mod
const frames = []
function createDocument() {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  frames.push(frame)
  return frame.contentDocument
}
beforeEach(async () => {
  vi.resetModules()
  mod = await import('../src/modules/iconFonts.js')
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const frame of frames.splice(0)) frame.remove()
})

describe('Material ligature document isolation', () => {
  it('measures, loads fonts and paints in the source document with explicit DPR', async () => {
    const ownerDocument = createDocument()
    const source = ownerDocument.createElement('span')
    source.className = 'material-icons'
    source.textContent = 'home'
    source.style.cssText = 'font-family:"Material Icons";font-size:24px;vertical-align:middle'
    ownerDocument.body.appendChild(source)
    const clone = source.cloneNode(true)
    const globalLoad = vi.spyOn(document.fonts, 'load')
    const globalAppend = vi.spyOn(document.body, 'appendChild')
    const localLoad = vi.spyOn(ownerDocument.fonts, 'load')
    let rasterSize
    let canvas
    const nativeEncode = ownerDocument.defaultView.HTMLCanvasElement.prototype.toBlob
    vi.spyOn(ownerDocument.defaultView.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (...args) {
      canvas = this
      rasterSize = [this.width, this.height]
      return nativeEncode.apply(this, args)
    })
    expect(await mod.ligatureIconToImage(clone, source, new Map([[clone, source]]), { dpr: 3 })).toBe(1)
    expect(localLoad).toHaveBeenCalled()
    expect(globalLoad).not.toHaveBeenCalled()
    expect(globalAppend).not.toHaveBeenCalled()
    expect(rasterSize[1]).toBe(72)
    expect(canvas.ownerDocument).toBe(ownerDocument)
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    expect(clone.querySelector('img').style.verticalAlign).toBe('middle')
    expect(ownerDocument.querySelector('[data-snapdom-internal]')).toBeNull()
  })

  it('releases the measurement node when layout measurement throws', async () => {
    const ownerDocument = createDocument()
    vi.spyOn(ownerDocument.defaultView.Element.prototype, 'getBoundingClientRect').mockImplementation(() => { throw new Error('layout failure') })
    await expect(mod.materialIconToImage('home', { ownerDocument })).rejects.toThrow('layout failure')
    expect(ownerDocument.querySelector('[data-snapdom-internal]')).toBeNull()
  })

  it('releases the raster buffer when encoding throws', async () => {
    const ownerDocument = createDocument()
    let canvas
    vi.spyOn(ownerDocument.defaultView.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function () {
      canvas = this
      throw new Error('encode failure')
    })
    await expect(mod.materialIconToImage('home', { ownerDocument })).rejects.toThrow('encode failure')
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    expect(ownerDocument.querySelector('[data-snapdom-internal]')).toBeNull()
  })

  it('registers static fallback fonts once in each owning document', async () => {
    const documents = [createDocument(), createDocument()]
    const globalAdd = vi.spyOn(document.fonts, 'add')
    for (const ownerDocument of documents) {
      vi.spyOn(ownerDocument.defaultView, 'FontFace').mockImplementation(function () {
        this.load = () => Promise.resolve(this)
      })
      const add = vi.spyOn(ownerDocument.fonts, 'add').mockImplementation(() => ownerDocument.fonts)
      vi.spyOn(ownerDocument.fonts, 'load').mockResolvedValue([])
      for (let i = 0; i < 2; i++) {
        await mod.materialIconToImage('home', { ownerDocument, family: 'Material Symbols Outlined', variation: '"FILL" 1', className: 'material-symbols-outlined' })
      }
      expect(add).toHaveBeenCalledTimes(1)
    }
    expect(globalAdd).not.toHaveBeenCalled()
  })

  it('removes failed static font registrations from their owning document', async () => {
    const ownerDocument = createDocument()
    vi.spyOn(ownerDocument.defaultView, 'FontFace').mockImplementation(function () {
      this.load = () => Promise.reject(new Error('font failure'))
    })
    const add = vi.spyOn(ownerDocument.fonts, 'add').mockImplementation(() => ownerDocument.fonts)
    const remove = vi.spyOn(ownerDocument.fonts, 'delete').mockReturnValue(true)
    await mod.materialIconToImage('home', { ownerDocument, family: 'Material Symbols Outlined', variation: '"FILL" 1', className: 'material-symbols-outlined' })
    expect(remove).toHaveBeenCalledWith(add.mock.calls[0][0])
  })
})
