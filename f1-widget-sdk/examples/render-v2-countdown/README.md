# Render v2 countdown input model

This isolated prototype proves the deterministic countdown reducer and the 100x310 RGB565 visual before any firmware write.

Interaction is deliberately level-based: chord down enters edit mode, bottom-encoder deltas change the draft, chord release arms/starts, and `tick.1s` decrements. Editing a running timer pauses it and snapshots the remaining time. The reducer, host preview, and future native implementation share those semantics.

## Input boundary

- **Accepted today:** bottom encoder ID 1 and its signed low-byte delta while the screen is active. Fn state is proven only inside that encoder callback.
- **Fn live fallback:** Fn + bottom encoder can edit immediately. Detecting Fn release by polling the accepted getter from the 100-ms UI tick needs a physical canary before it can be called live-safe.
- **Configurable chord:** the Input app can capture any configured chord and emit ordered level transitions through `widget.v2.event` ID `0xB210`. This is modeled, not yet accepted: the current live RPC admits only `0xB201`, so the native allowlist and queue need a bounded extension.
- **Direct keyboard hook:** arbitrary key identity and release fields are not known. The old experimental hook proved only stock-first routing plus an any-key pressed bit, so it is not used as evidence here.

Generate the six exact lifecycle frames and contact sheet:

```sh
node f1-widget-sdk/examples/render-v2-countdown/build.mjs
```

Run the model and frame-hash gates:

```sh
node --test f1-widget-sdk/test/render-v2-countdown.test.mjs
```

The generated manifest names every frame hash and repeats the capability boundary. The script performs no device I/O.
