import config from './vitest.snapshot-native.config.js'

// Each test may create full DOM/SVG documents. One page per engine avoids
// saturating the host with dozens of browser sessions during correctness checks.
config.test.browser.fileParallelism = false

// Keep the fork's acceptance command explicit and independent of upstream
// browser-module mocking tests. These regressions exercise native browser APIs.
config.test.include = [
  'blob-session-lifetime', 'capture.cross-realm', 'capture.layout-fidelity',
  'capture.session-cleanup', 'clone.hidden-subtree', 'core.capture.rootPadding',
  'core.capture.more', 'default-sandbox-lifetime', 'export.canvas-lifetime',
  'exporter.toCanvas.density', 'fonts.data-stylesheet', 'fonts.cooperative', 'fonts.soft-cache', 'fonts.pruned-usage',
  'icon-font-context', 'icons.isolated-context', 'image-cache-lifetime', 'images.hidden-intrinsic',
  'module.lineClamp', 'node-global-collision', 'regression.scrollLayout',
  'scheduler-lifetime', 'scheduler-background', 'snapshot-state', 'styles.signature-lifetime',
  'export.paint-lifetime',
  'prepare.css-emission',
  'css.cooperative',
  'api.rasterize',
  'snapshot-transfer', 'snapFetch.effective-origin',
  'styles.intrinsic-ellipsis',
  'export.shadow-probe-lifetime',
].map(name => `__tests__/${name}.test.js`)
export default config
