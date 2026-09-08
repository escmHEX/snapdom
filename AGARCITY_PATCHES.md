# Capture fidelity maintenance

This fork is based on upstream SnapDOM 2.24.15, commit
22710932feedf66c5b8320a55fdabeb8b1cfafd3. The upstream MIT license and attribution
remain unchanged. All corrections are generic HTML/CSS behavior; the downstream
application supplies its own surface, canvas snapshots and upload contracts.

## Snapshot ownership

Animation acquisition indexes targets and pseudoelements by identity. Repeated
keyframes/effects read each computed property only once per target/pseudo in the
synchronous snapshot task; no cache or invalidation work survives that task.

The `@zumer/snapdom/snapshot` entry exposes `snapshot(element, options)` and
`materializeSnapshot(snapshot, options)`. The first call is synchronous. It copies
DOM structure, CSS, viewport and dynamic state before returning. Materialization
works from those copies in an isolated document; later live-document updates are
not incorporated. The existing public capture/export API remains available.

The isolated document restores viewport dimensions, color scheme and captured
custom properties. It does not virtualize the operating-system environment:
resolution media queries and direct descendant `env()` declarations still use
that document's browser environment. Keep that environment stable while
processing. The downstream web HUD uses captured custom properties for safe
areas and no DPR-dependent resolution rules; moving between monitors during
processing is not part of its current fidelity certification.

The minimal snapshot import can be bundled eagerly while the materializer and
capture/export code remain lazy. For example:

```js
const state = snapshot(surface)
try {
  const { materializeSnapshot } = await import('@zumer/snapdom/snapshot')
  const { snapdom } = await import('@zumer/snapdom')
  const isolated = await materializeSnapshot(state, { budgetMs: 1 })
  try {
    return await snapdom.toCanvas(isolated.element, {
      cache: 'soft', fast: false, budgetMs: 1,
      embedFonts: true, reconcile: false, compress: false
    })
  } finally {
    isolated.dispose()
  }
} finally {
  state.dispose()
}
```

`state.nodeFor(original)` identifies the copied node. The materialized document's
`nodeFor(copiedNode)` resolves its counterpart for generic node replacement
plugins. Neither mapping is used to reread the original document during export.
The caller owns both objects and must dispose them in success and error paths.

By default, CSSOM content is copied during acquisition. `immutableStyleSheets`
accepts exact URLs whose bytes are versioned and whose CSSOM is never mutated by
the caller. Only these resources may be loaded from their recorded URLs later.
This avoids serializing large static stylesheets during the input task. It is an
explicit immutability contract, not an automatic assumption about link elements.
Unsupported live resources fail explicitly instead of silently taking newer state.

## Generic corrections

- Text truncation measures isolated copies, including prepared pseudo-elements;
  no text/style restoration can overwrite a concurrent application update.
- Scroll translation preserves flex/grid layout, signed offsets, clipping,
  padding, borders and positioned descendants. Zero-width overlay gutters remain
  zero-width in foreignObject; positive reserved gutters are preserved. Native
  system scrollbar painting can differ between browser rasterization paths.
- Exclusion adjustment uses the clone/source map and actual in-flow removals.
  Generated pseudo-elements and removed absolute layers do not mispair siblings.
- Icon replacements keep their original layout context. Font measurement and
  loading use the captured document and pixel density. PNG encoding uses the
  asynchronous canvas codec and CPU-backed icon buffers to avoid synchronous
  GPU readback, keeping each buffer alive until encoding finishes.
- Cross-document nodes use their own realm, and native Node constants remain
  valid when a host bundle declares an unrelated class named Node.
- Cooperative sessions share a time budget and idle deadline across traversals.
  Base style generation yields between tags and scrollbar extraction between
  rules. Synchronous helpers consume the same traversal, preserving CSS output;
  cancellation closes the traversal without caching a partial result.
  Native browser calls remain atomic; a budget does not promise an upper bound
  on their execution time. Cancellation stops subsequent work and releases
  temporary surfaces; non-cancellable native results are reclaimed on arrival.
- Soft sessions refresh DOM-dependent data without persistent invalidation
  observers or listeners. Resource caches exclude transient blob/data URLs and
  do not retain the last detached document or its embedded-font CSS.
- Non-painting HTML subtrees avoid unnecessary descendant processing; SVG
  definition trees remain available to visible references. Hidden image husks
  keep their structural attributes and use the shared transparent PNG instead of
  invisible sources. Leaving an adopted cloned image source-less can retain its
  original document through Chromium's native viewport-change listener; the
  valid neutral source avoids that retention for hidden and clipped image husks.
  Visibility-hidden images retain their intrinsic dimensions through an empty
  SVG, so replacing their pixels does not change sizing or inline baselines.
- Font usage follows the retained node map, including current form values,
  placeholders and pseudo-elements. Removed text does not select unused subsets;
  invisible text that still affects layout continues to retain its fonts.
- Generated CSS declarations use the browser's own shorthand normalization,
  cooperatively per unique class. Cache keys and selector ordering stay intact.
- WebKit raster density uses the capture serializer's existing HTML wrapper to
  preserve positioned layout and shadows at higher DPR. Its intrinsic raster
  density rounds upward to an integer before resampling to the requested output:
  fractional CSS zoom shifts inline text baselines in WebKit SVG images. This
  increases temporary raster area by 2.56x for DPR 1.25 versus density 1.25;
  existing raster-size limits still apply. Arbitrary external SVG
  foreignObject trees retain the previous export behavior: inserting a wrapper
  there would change user CSS child selectors. This correction covers generated
  SnapDOM captures, not a general rewrite of externally supplied SVG documents.

## Distribution and updates

The `./rasterize` entry exposes the existing canvas exporter independently of DOM
acquisition. A consumer can pass a captured SVG URL and its capture metadata to
another document, without cloning the live page again or duplicating the
browser-specific exporter. Execution isolation and pixel transport belong to the
consumer; the library does not promise that an iframe gets a separate process.

Release commits include distributions generated by the existing `npm run compile`
command. Consumers pin the complete release commit SHA. Installation does not
require a prepare/postinstall build. Never edit dist files manually; compare two
builds byte-for-byte and validate clean installation before updating a consumer.

The root package intentionally has no npm `workspaces` field or Git build-trigger
scripts (`build`, `prepare`, `prepack`, `preinstall`, `install`, `postinstall`).
[npm's Git dependency rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#git-urls-as-dependencies)
otherwise install development dependencies and prepare the repository even when
precompiled artifacts are committed. Maintainers use `npm run compile` or the
explicit `npm run pack:dist` command. The plugin packages under `packages/` remain
independent source packages; their relative source imports in tests do not require
root workspace links. Install or pack those packages from their own directories.

For upstream updates, compare each correction and run its generic regressions in
Chromium, Firefox and WebKit. Remove a correction only when the upstream replacement
passes that regression. Then run downstream temporal, visual, lifecycle and
renderer/resource acceptance before changing the pinned SHA. Do not maintain a
second capture engine or automatically submit upstream pull requests.

## Current validation status

Run the native regression set with `npm run test:capture-fidelity`. Set `BROWSER`
to `all` for Chromium, Firefox and WebKit (the default is Chromium). The dedicated
configuration removes the browser automation color-scheme override so isolated
document inheritance is tested against the browser's normal behavior.

Validated on 2026-09-08: 620 native regression tests passed across Chromium,
Firefox and WebKit, with four explicit skips; TypeScript and source ESLint passed.
The downstream local matrix completed 180 independent captures and 18 viewport,
theme and quality transitions. All captures preserved the original DOM. All 99
pixel-analysis flagged comparisons were individually reviewed, retaining the
documented native-control, native-scrollbar and WebKit fractional-border painting
exceptions. Delayed-processing temporal tests were pixel-identical in all three
engines after deliberate live-DOM and canvas changes following acquisition.

The downstream native 240 Hz comparison used five cold and twenty warm captures
per implementation. Warm omitted-frame medians fell from 56 to 2; maximum frame
intervals across the series fell from 191.6 ms to 12.8 ms. This is a measurement on
one Windows desktop, not a mobile performance claim or a processing deadline.
Twenty captures and equivalent controls showed no sustained retained-resource
growth. Separate idle instrumentation found no capture-owned pending timers,
observers, callbacks or renderer documents after completion. These application
measurements are local evidence, not universal performance guarantees.
The complete upstream suite is not certified: an earlier broader run hit a Vitest
module-mock initialization error also reproduced on the unmodified upstream commit
in a separate worktree. Targeted regression results do not imply a full-suite pass.
## Portable snapshots and isolated materialization

`serializeSnapshot` transports only the already acquired inert snapshot. It emits
node records rather than HTML strings, preserving namespaces, comments, template
content and parser-sensitive topology. Its packet contains a structured-clone
payload, transferable canvas ImageBitmaps and `nodeId(originalOrCopy)` for plugin
references. Keep the source alive until serialization and ID lookup finish;
concurrent disposal rejects instead of returning a partial snapshot. Metadata is
copied independently, including nested frozen stylesheet rules. Packet disposal
closes unsent bitmaps and releases its source lookup, and is safe after transfer.

`deserializeSnapshot` consumes incoming bitmaps and creates an inert owned tree.
It supports `nodeFor(id)` and closes incoming bitmaps on success, abort and failure.
`materializeSnapshot(snapshot, { document })` can reuse an exclusively owned
connected document, such as an isolated renderer. The caller supplies the captured
viewport and color scheme; compatibility mode must match. Sanitization occurs
before the captured tree is connected. The original document element is restored
on disposal without `document.open()`, which would erase protocol listeners.
The default nested sandbox path remains available when no document is supplied.

An opaque sandbox cannot access a nested same-origin sandbox. Document reuse is
therefore required there. Public external CSS/font/image resources still need
normal CORS permission. Resource credential inference uses the effective global
origin, including the opaque `null` origin, while preserving explicit overrides
and existing proxy credential behavior.

Cooperative processing defaults to idle callbacks. The optional schedulerMode: 'background' uses native background-priority postTask with AbortSignal, or a closed one-shot MessageChannel when unavailable. This allows isolated documents to progress without relying on spare-time callbacks that can be starved offscreen; the same per-slice budget and atomic-item boundary remain. It adds no total processing deadline.

Font embedding reads accessible link CSSOM before applying external-fetch URL heuristics. Materialized immutable CSS can be carried by data stylesheet links; excluding those links and then skipping their CSSOM discarded every font face despite correct document layout. The generic data-link regression reproduces that loss without game-specific names.

Raster image decoding observes AbortSignal while a resource is pending. Cancellation consumes the original decode promise and enters the existing neutral-PNG cleanup; rejection waits for that replacement load rather than releasing the image early. No total capture timeout is introduced. Real retained-response probes pass in Chromium, Firefox and WebKit.

The separate rasterize API accepts the standard canvas `willReadFrequently`
hint for consumers that transfer their export to a CPU encoder. It applies to
the export canvas only; the default renderer and live source are unchanged.
The browser decides its backing implementation. This is not a guarantee about
GPU scheduling or frame rate. Cropped output has a native pixel regression.
