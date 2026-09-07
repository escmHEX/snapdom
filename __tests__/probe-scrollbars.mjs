import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'
const root = process.cwd()
const bundle = await build({ entryPoints: ['src/index.js'], bundle: true, format: 'esm', write: false })
const out = resolve(root, '__tests__/scroll-evidence')
await mkdir(out, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return }
    let path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!extname(path)) path = resolve(path, 'index.js')
    if (!path.startsWith(root)) throw Error('outside root')
    res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'text/html')
    res.end(await readFile(path))
  } catch { res.statusCode = 404; res.end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 600, height: 500 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('console', m => console.log(m.text()))
    page.on('requestfailed', r => console.log('FAILED', r.url(), r.failure()))
    await page.goto(`http://127.0.0.1:${server.address().port}/package.json`)
    await page.setContent('<style>body{margin:0}.box{width:220px;height:140px;border:3px solid black;overflow:scroll;background:#1288aa}.content{height:650px;width:350px;background:repeating-linear-gradient(#1288aa 0px,#1288aa 39px,#773355 40px,#773355 79px)}</style><div class="frame" style="width:226px;height:146px"><div class="box"><div class="content"></div></div></div>')
    await page.evaluate(y => document.querySelector('.box').scrollTop = y, mobile ? 0 : 180)
    const prefix = mobile ? 'mobile' : 'desktop'
    await page.locator('.frame').screenshot({ caret: 'initial', path: resolve(out, `${prefix}-native.png`) })
    const result = await page.evaluate(async () => {
      const { snapdom } = await import('/probe.js')
      const source = document.querySelector('.box')
      const canvas = await snapdom.toCanvas(document.querySelector('.frame'), { scale: 1, embedFonts: false })
      return { png: canvas.toDataURL(), metrics: { offsetWidth: source.offsetWidth, clientWidth: source.clientWidth, offsetHeight: source.offsetHeight, clientHeight: source.clientHeight, scrollTop: source.scrollTop } }
    })
    await writeFile(resolve(out, `${prefix}-snapdom.png`), Buffer.from(result.png.split(',')[1], 'base64'))
    console.log(prefix, result.metrics)
    await context.close()
  }
} finally { await browser.close(); await new Promise(r => server.close(r)) }
