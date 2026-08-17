# Render v2 event prototype

This is a hardware-free, pixel-exact prototype of the event layer proposed on
top of renderer-v1. It does not run JavaScript on the device. `widget.js` is an
ES5-compatible authoring facade that the host compiler parses into bounded
state instructions and RGB565 patch bindings. The build's source of truth is
the exact `prepareRenderV2(widget.html, widget.css, widget.js) -> linkRenderV2
-> F2EP` path; no hand-built program supplies the generated frames.

The four generated frames prove the requested transitions on the real 100x310
logical canvas:

1. Boot at `12:34:56`, authored knob option `1`, host value `0`.
2. The synthesized one-second event advances the clock to `12:34:57`.
3. Fn plus the bottom knob changes the visible authored option from `1` to `2`.
4. fixed host RPC event `0xB201` changes the visible host value and its color to
   value `7`.

The clock reuses one set of ten compact digit glyphs with six divisor bindings.
There is no table of 86,400 complete clock frames.

## Run it

From `f1-widget-sdk`:

```sh
node examples/render-v2-events/build.mjs
node --test test/render-v2.test.mjs test/render-v2-events.test.mjs
```

Open `build/contact-sheet.png` to see all four states. The build also emits the
exact 62,000-byte RGB565-LE frame for every state, a PNG projection of each
frame, the compiled `.f2ep` event program, semantic scene, readable code-native
glyph atlas, and `build/manifest.json` with hashes and admitted budgets.

The current artifact uses:

- one borrowed renderer-v1 framebuffer and zero additional framebuffers;
- 3 integer state slots;
- 3 event handlers;
- 8 bindings;
- 3 patch sets / 23 variants / 322 glow-complete spans;
- 6,440 bytes of RGB565 patch pixels;
- a 9,536-byte canonical F2EP binary;
- a 128-byte, eight-record event queue.

The test compares every SDK-runtime frame to the independent firmware VM and to
a fresh full semantic re-render; every state requires zero differing pixels.
It also requires the SDK and firmware F2EP encoders to produce identical bytes
and manifests, and proves Fn gating, bottom-encoder filtering, and fixed host
RPC ID rejection.

MicroQuickJS is intentionally not needed for this deterministic target. It can
become an optional execution backend later while preserving this same event,
state, binding, memory, and recovery ABI.

This example does not touch live renderer-v1 sources, Music, WPM Pet, a firmware
image, or a connected keyboard.
