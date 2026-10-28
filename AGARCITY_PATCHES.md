# Capture fidelity maintenance

This fork is based on upstream SnapDOM 2.24.15, commit
22710932feedf66c5b8320a55fdabeb8b1cfafd3. The upstream MIT license and attribution
remain unchanged. All corrections are generic HTML/CSS behavior; the downstream
application supplies its own surface, canvas snapshots and upload contracts.

## HUD text flow and image resources

Percentage widths, including nested percentage inputs, retain their resolved CSS
expression beneath an explicitly intrinsic-width parent. Freezing those widths
as used pixels changes their cyclic contribution to `max-content` sizing and
moves following controls. This uses the capture's existing Typed OM snapshots;
browsers without Typed OM keep the measured-width fallback.

Fractional border widths reuse the frozen-width serialization slack before a
second pixel snap at CSS zoom. Physical and logical widths, including normalized
inline declarations, keep the same painted thickness instead of losing a pixel
to CSSOM decimal truncation.

Capture preserves Typed OM unitless line heights and in-flow automatic heights.
Resolving them to used pixels can change line spacing under fractional zoom or
leave rewrapped text outside its box. Positioned and replaced boxes retain their
measured heights. These values reuse the existing per-capture computed-style map
and do not restore properties removed by `excludeStyleProps`.

Image inputs use the existing image resource inlining path without inserting
fallback dimensions, including when `fallbackURL` supplies the resource.
Immutable stylesheet URL rebasing treats CSS comments as
opaque, including unmatched quotes, so fetched stylesheet resources retain their
original base URL inside the isolated renderer.

## Adopted document stylesheets

Structural snapshots freeze constructed document stylesheets in adoption order,
including CSSOM rules, media and disabled state. Materialization recreates them
in the isolated document without inserting elements that alter selectors. Frozen
selectors and used font discovery include these sheets; disposal restores any
preexisting adopted sheets of a supplied document. All work belongs to a capture.

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

## Intrinsic text sizing and stylesheet zoom

The style-copy pass retains cascade-resolved min-content, max-content and
fit-content widths through CSS Typed OM. Auto widths on shrink-to-fit displays
also remain content-sized. Freezing these as rounded used pixels can wrap labels
or let a slightly wider rasterized name overlap its following separator. Physical
and logical width declarations stay consistent, including vertical writing modes;
authored fixed widths and max-width constraints keep their existing behavior.
Browsers without Typed OM retain the existing used-width path rather than guessing
the cascade from inline declarations. CSS zoom is paint-relevant and is retained
when authored through stylesheets as well as inline styles.

These reads occur in the cooperatively scheduled style-copy pass on the isolated
snapshot. Acquisition, scheduler budgets, resource timeouts, cancellation and the
live application render loop are unchanged. The Typed OM value is read once per
style snapshot and reused by the existing width-preservation decision.
Known intrinsic widths also skip the older content probes and reconciliation-risk
bookkeeping: their width is emitted directly, so those probes cannot affect it.
The acceptance suite includes the existing packed-row, fixed-width, replaced-element
and root-zoom regressions as well as the intrinsic-sizing cases.

Auto flex/grid items and shrink-to-fit positioned containers retain automatic
widths too. Automatic margins and positioned insets remain layout inputs instead
of frozen used pixels; otherwise centering or opposing offsets can constrain a
row to its old text metrics. Replaced elements and absolute roots stretched by
two explicit horizontal insets retain their measured dimensions. Physical sides
are resolved through Typed OM; logical aliases cannot override those values.
These values share the existing per-capture style snapshot and computed-style
map, without live-page measurements or additional render-loop work.

Native Chromium device scaling must be tested separately from Playwright's DPR
emulation: on Windows, a native 150% scale with viewport:null reproduced font
wrapping that an emulated deviceScaleFactor:1.5 did not. Layout regressions model
that metric drift, and the raster root regression checks the right-edge pixels
after root normalization. Real client validation additionally compares native
browser screenshots with exported PNGs at native 100%, 125% and 150% scales.

## Authored scrollbar fidelity

Scrollbar extraction now retains nested `@supports` rules. Real scrolling clones
retain their inherited custom properties because the emitted pseudo rules still
contain `var()` expressions. Content-box used sizes exclude classic gutters;
serialization restores that space once so the cloned viewport does not shrink or
create a spurious second scrollbar.

Translated scrolling content retains buttonless authored scrollbar parts in a
separate clipped viewport and gutter grid. Paint comes from computed pseudo
styles, with measured gutters and signed scroll offsets (including RTL and
column-reverse). The native corner is painted by a zero-client-area scroller,
without guessing its theme color. Automatic minimum thumb sizing is measured
from a 102-by-102 native SVG paint once per capture, shared through the capture's
existing style-cache lifetime. It reuses the abortable raster exporter and releases
its canvas immediately. A native gutter measurement is insufficient: newer engines
use a separate platform minimum. This follows the browser's custom-part sizing model:
https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/layout/layout_custom_scrollbar_part.cc

This targets the client's solid, buttonless custom parts. Native OS/overlay
scrollbars outside Gecko retain their previous behavior; this is not a general OS-theme
reimplementation or certification of arbitrary scrollbar buttons, images,
track-piece margins or platform animations. These reads and nodes belong only to
capture processing, never acquisition, application listeners or a render loop.

Run `npm run test:scrollbars` in Chromium for exported-pixel regressions: nested
rules, inherited colors, content/border boxes, both axes, portable snapshots,
scrolled content, RTL, reversed flow and native minimum-thumb geometry. The
native reference removes only the Vitest runner's outer iframe scaling while
taking the screenshot, then restores it. Edge antialiasing is separated from
painted geometry. Also run the existing capture-fidelity acceptance suite.

Validation on 2026-10-28: 11 scrollbar regressions passed in Chromium. The
cross-engine acceptance run passed 796 tests with 14 skips; three intrinsic-width
assertions failed in WebKit and failed identically on the unchanged a6df554 base.
A 20-pair alternating Windows/IAB trial at DPR 1.5 measured median DOM export
119.8 ms before and 122.6 ms after (P95 141.3/157.6 ms). This bounds this fixture's
capture work, not gameplay FPS or performance on other hardware. The live source
was unchanged and no renderer frames remained after the trial.


## Gecko native scrollbar fallback

Firefox's ScrollContainerFrame deliberately creates no scrollbars for SVG image
objects (GetNeededAnonymousContent / IsBeingUsedAsImage). Reconstruct its visible
scrollable axes only in capture preparation, reusing the authored-bar viewport
and grid. Firefox on iOS retains the WebKit path. Chromium and WebKit do not use
this fallback. No application listeners, acquisition work or gameplay-loop checks
are added.

The source's computed scrollbar-color, scrollbar-width, gutters, viewport,
scroll extent and signed offset drive the result. Zero-offset scrollers need the
same treatment as scrolled ones. Gecko's computed content width already contains
its gutter, so it must not be added again. Overlay bars occupy the existing grid
cell without narrowing the content. Hidden overflow and scrollbar-width:none do
not produce bars. The source DOM and scroll state remain untouched.

This is an explicitly accepted approximation, not native theme replication:
CSS does not expose native buttons, minimum thumb size, overlay thickness or fade
state. `scrollbarFallback.js` owns the fallback dimensions; auto colors use system
colors under the source color-scheme. An overflowing Gecko element with visible
scrollbar CSS gets a persistent captured bar even when the OS overlay can fade.
No raster probe is required for this path. Existing non-Gecko behavior is unchanged.

Validation: run the scrollbar matrix headless, plus `BROWSER=firefox` with
`--browser.headless=false`. Headless Gecko can force computed scrollbar-width:none;
those geometry cases are explicitly skipped there and must pass headed. The
Gecko tests exercise portable snapshot transport at zero/nonzero offsets, both
axes, hidden bars, RTL and reverse flex. Native reference tests skip when the
browser itself does not paint a reference bar. Geometry tests use fast snapshot
serialization to avoid foreground/idle scheduling influencing their timeout.

On Windows, a fixture using the actual client's desktopControls.css produced
identical before/after PNG pixels in Chromium and WebKit. Firefox classic and
overlay screenshots were reviewed against native images; source state remained
unchanged and no iframe remained after capture. Ten alternating measured pairs
(after warmup) gave Firefox classic median 24.5/26 ms and overlay 27/27.5 ms;
Chromium 12.25/12.15 ms and WebKit 204.5/211.5 ms. These short trials describe
capture latency and its noise, not a gameplay performance claim or certification
of every OS, browser build, mobile device or native display scale.


Independent scrollbar review: source align-items/justify-items also applied to
capture-only grid children, collapsing or shifting their tracks for centered
layouts. The compositor now stretches its own grid items while the original
alignment remains on the inner content. Pixel regressions cover both alignment
axes. This adds no DOM reads, traversal, raster probes or application runtime work.
