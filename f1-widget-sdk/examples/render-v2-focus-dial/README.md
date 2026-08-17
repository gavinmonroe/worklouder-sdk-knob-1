# Render v2 focus dial

This is an offline, pixel-exact adaptation of a black focus-clock face for the
Framer F1's 100x310 logical canvas. A large `HH:MM` clock and tiny live seconds
sit above a lower-half orange radial dial with five arc marks. Fn plus the
bottom knob moves the active dial detent; fixed RPC `0xB201` synchronizes the
clock from seconds since midnight; `tick.1s` advances it locally.

The status row begins at y=16 and every live mark stays at least five pixels
inside the left and right physical edges. The four large digits occupy x=5..91,
so no segment relies on the display's clipped perimeter.

The current semantic 5x15 renderer cannot draw the reference honestly: it has
only a flat background and centered 1-bit glyphs in fixed 20x20 cells. This
example therefore rasterizes its circle, eased radial color, large digits,
and labels offline in `raster-design.mjs`, then calls `linkRenderV2Raster` with
an exact 62,000-byte RGB565-LE base and explicit bounded variants for each
logical binding. The device-side format remains the unchanged deterministic
F2EP event VM; no browser, gradient engine, vector renderer, or JavaScript
runtime is added to firmware. The radial falloff is continuous in the offline
renderer and quantized only once to the device's RGB565 output.

From `f1-widget-sdk`:

```sh
node examples/render-v2-focus-dial/build.mjs
node --test test/render-v2-focus-dial.test.mjs
```

Open `build/contact-sheet.png` for boot, one-second tick, three successive dial
clicks across the five-detent arc, and a host clock sync to `02:12:00`. The build emits exact RGB565 frames, PNG
projections, the pre-rendered base, semantic authoring scene/atlas, F2EP
program, and a hash/budget manifest.

The current admitted program uses 2 state slots, 3 handlers, 7 bindings, 3
deduplicated patch sets, 25 variants, 500 of 512 patch spans, and 10,646 of
16,384 RGB565 patch bytes. F2EP is 15,162 bytes. It borrows the existing
62,000-byte framebuffer and requires zero additional framebuffer bytes. The
large `HH:MM` changes naturally on minute boundaries; the tiny `SS` readout is
what makes each one-second event visible.

This directory is an offline preview only. It does not change the accepted
`render-v2-events` canary, native firmware, a combined image, Music, WPM Pet,
or a connected keyboard.
