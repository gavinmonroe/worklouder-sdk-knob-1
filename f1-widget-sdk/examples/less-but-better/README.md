# Less but better browser-raster widget

This first-class example proves the arbitrary-HTML/CSS path. Its radial
gradient, animated transform, SVG `feTurbulence`, blend mode, and captured
hover state intentionally exceed the semantic F1SC subset. A sandboxed local
Chromium instance paints the source at exactly 100×310; the SDK composites and
quantizes those pixels to RGB565, fits the largest cadence-valid frame set under
128 KiB, and emits an F1RA animation.

Build without accessing a keyboard:

```sh
npm --prefix f1-widget-sdk run renderer:raster-example
```

Outputs in `build/` include the F1RA binary, decoded RGB565 preview frames as
PNG, and a manifest with source/artifact hashes, selected frame indices, delta
modes, raw size, encoded size, and remaining headroom. The example asks for two
frames at 2 fps over one second. Edit `widget.html` and `widget.css`, rebuild,
then inspect the decoded PNGs—the PNGs, not an unconstrained browser window,
are the exact pixels represented by the device payload.

The capture sandbox permits inline markup, CSS, data resources, and local SVG
fragment references such as `url("#noise")`. It blocks scripts, event-handler
attributes, embedded documents, navigation, external resources, `@import`, and
JavaScript URLs. Input Lab supports only fixed `none` or captured `hover`
interaction; this example selects `hover`.

Nothing here builds or flashes firmware. See
[`../../docs/css-renderer.md`](../../docs/css-renderer.md) for viewport clipping,
memory fitting, mixed three-slot bundles, and the remaining device gates.
