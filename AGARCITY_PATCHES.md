# Capture fidelity maintenance

Status: source-only candidate, NOT accepted for production distribution.
Do not install this branch as the downstream game dependency.

This fork is based on upstream SnapDOM 2.24.15, commit
22710932feedf66c5b8320a55fdabeb8b1cfafd3. The upstream MIT license and attribution
remain unchanged. Corrections must be generic HTML/CSS behavior, with no game
selectors, names, roles or viewport-specific exceptions.

The capture-fidelity branch addresses read-only text truncation and preservation
of scrolled layout. Source changes and their browser regressions are maintained
separately from the downstream game integration. No upstream pull request is
submitted automatically.

## Distribution contract

Release commits include generated dist files produced by the existing
`npm run compile` command. Consumers pin the complete release commit SHA.
Installation must not need a prepare/postinstall build or a global compiler.
Do not edit dist files manually. Verify a second build has identical bytes and
validate a clean installation before changing a consumer's pinned commit.

## Updating upstream

For each upstream update, compare the source fixes and run the generic
regressions in Chromium, Firefox and WebKit. Remove a local correction only when
the replacement upstream implementation passes its regression. Then run the
downstream visual, lifecycle and performance acceptance before changing its SHA.
Do not adopt a moving branch dependency or maintain two runtime implementations.

## Verified changes and acceptance boundary

- Source text is snapshotted during cloning and measured in an isolated copy,
  including prepared pseudo-elements. A concurrent application update is not
  restored over. Unicode grapheme boundaries use Intl.Segmenter when available;
  engines without it retain valid code-point boundaries, not full grapheme rules.
- Scroll translation keeps the original flex/grid layout context, signed offsets,
  padding and inline formatting. Positioned descendants whose containing block is
  outside the scroller stay outside the translated wrapper.
- No zero-gutter scrollbar suppression is included: the isolated mobile probe did
  not demonstrate that hypothesis. Headless native references must remove
  Playwright's default --hide-scrollbars flag.

Targeted tests: 93 passed across Chromium, Firefox and WebKit. Run from this fork:

```powershell
$env:BROWSER='all'
npx vitest run __tests__/module.lineClamp.test.js __tests__/regression.readonlyClamp.test.js __tests__/regression.scrollLayout.test.js --browser.headless
Remove-Item Env:BROWSER
node __tests__/probe-scrollbars.mjs
```

A broader attempt including core.prepare.test.js stopped on a Vitest module mock
initialization error. The same error reproduced with unmodified upstream commit
22710932feedf66c5b8320a55fdabeb8b1cfafd3 in a separate baseline worktree.
The complete upstream suite is not certified.

The scrollbar probe still shows missing native tracks/thumbs for a scrolled
classic scrollbar (source offset 226x146, client 205x125, scrollTop 180). The
versioned desktop-native.png and desktop-snapdom.png demonstrate this remaining
failure. Preserving layout geometry does not certify painted scrollbar fidelity.

The downstream game comparison also retains an introduced line wrap in spectator
text; reconcile:true did not resolve it. No release dist commit, consumer SHA
update, complete performance certification or downstream bundle delivery was made.

Read-only scope: existing source text/styles are not rewritten. The measurer is
mounted under document.body and removed in finally. Capturing body or
documentElement necessarily observes this temporary host as a child mutation;
ordinary capture subtrees do not contain it. Rich HTML text truncation remains
outside the plain-text helper's existing coverage.
