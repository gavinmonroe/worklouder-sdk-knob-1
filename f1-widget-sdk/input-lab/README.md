# Input Lab editor

Input Lab is a host-side editor for the exact `100x310` Framer F1 logical canvas. It has two reusable
compiler lanes:

- **Semantic CSS** uses the shared scene compiler and a cached, SHA-pinned Hiragino/ImageMagick glyph
  atlas. The canvas advances on the same 100 ms device ticks and draws those compiled atlas masks.
- **Chromium raster** paints sandboxed inline HTML/CSS/SVG in one version-pinned headless Chrome CDP
  session, seeks CSS animations to exact frame times, quantizes to RGB565, fits the result to the hard
  128 KiB F1RA limit, decodes it again, and previews the decoded device frames—not the browser originals.

The three distinct seeded previews are `Working`, `Less better`, and `Electric`. Their source,
settings, and compact compiled payload are stored locally. `Apply / Push` always compiles all three
into one F1WB bundle; the active slot is visible at all times.

## Start the standalone lab

```sh
cd f1-widget-sdk
npm run input-lab
open http://127.0.0.1:9231
```

`Apply / Push` uses `MockSceneTransport` by default. It records the F1WB bundle and active slot in
memory and performs no device discovery or I/O. A production caller must explicitly inject an object
with `applySceneBundle()`. `FailClosedLiveSceneTransport` throws
`NO_LIVE_INPUT_LAB_SCENE_TRANSPORT`; there is no implicit live fallback.

Raster capture rejects scripts, event handlers, `<base>`, embedded documents, network/file resources,
and external URLs. Inline SVG/CSS filters such as `url(#noise)` and cached `data:` assets are allowed.
The optional Hover setting is a fixed captured state: `:hover` selectors are rewritten to the bounded
capture class; it does not synthesize pointer movement during the loop. Capture reports the exact Chrome
product, source-frame count, selected-frame count, changed-pixel ratio, raw/encoded sizes, headroom,
and whether frames were auto-reduced. The default 10-source-frame capture completes in one Chrome
process; the current pinned product is `Chrome/151.0.7922.138`.

The editor must be loaded from the localhost server. Each server start creates a new 256-bit session
token and injects it into the served editor; only same-origin `application/json` requests carrying that
token may call `/api/apply`. Compile and capture remain read-only, and wildcard CORS is not enabled.

## Run inside the separate Input Lab.app

The editor can run in a copied, unsigned research build without modifying `/Applications/input.app` or
the original `artifacts/Input Lab.app`. Preparing only the source is an explicit deterministic step:

```sh
cd f1-widget-sdk
npm run input-lab:prepare-app -- --force
```

For a directly launchable copy without an ASAR dependency:

```sh
npm run input-lab:build-app -- --force
npm run input-lab
open -na "$PWD/input-lab/build/Input Lab Editor.app" --args --input-lab
```

The builder copies `artifacts/Input Lab.app` only into `input-lab/build`, replaces `app.asar` only in
that new copy with the prepared `Resources/app` directory, and refuses paths outside those exact
workspace roots. The patched main process loads `http://127.0.0.1:9231` only with `--input-lab`;
ordinary Lab launches retain the original `dist/index.html`. The localhost server is therefore the real
compiler/transport path rather than an inert file route. No tool in this workflow writes to the signed
production app.

Reusable host APIs are exported as `framer-f1-research-widget-sdk/input-lab`.

## Test

```sh
npm run input-lab:test
npm test
```
