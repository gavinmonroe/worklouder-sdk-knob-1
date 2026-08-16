# Katakana matrix CSS lowering proof

This hardware-free example compiles the supplied browser-style matrix into a
bounded `framer-css-scene-v1` render plan for the Framer F1's logical 100×310
canvas. It does not put a browser or a CSS parser on the keyboard.

Run:

```sh
node f1-widget-sdk/examples/jp-matrix/build.mjs
```

The build emits a deterministic scene, pinned Hiragino 1-bit glyph atlas,
tick-zero RGB565 golden frame, and a three-preset `F1WB` bundle in `build/`.
Open `widget.html` in a browser for the design preview; SDK/Input previews should
use the generated atlas and `renderCssSceneRgb565` for exact device pixels.
The trailing `device-preview.css` contains the intentional 1920×1080-to-100×310
adaptation; it is not treated as part of the firmware scene source.

Current proof boundaries:

- 75 visible cells arranged as 5 columns × 15 rows;
- 71 unique Katakana glyphs rasterized from a SHA-pinned local Hiragino font;
- all twelve `nth-child` animation schedules resolved at compile time;
- one shared five-stop keyframe track, sampled at the proven 100 ms UI tick;
- 1,048-byte scene, 2,004-byte atlas, and an estimated 65,084-byte persistent runtime;
- three named blue/violet/emerald presets in a 9,488-byte mixed-kind-capable bundle;
- no firmware image, RPC scene handler, Input settings pane, or hardware write.

See [`../../docs/css-renderer.md`](../../docs/css-renderer.md) for the proposed
Input authoring and device runtime architecture.
