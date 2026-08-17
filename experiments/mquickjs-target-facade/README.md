# MicroQuickJS mailbox-to-pixels target facade

Status: **`STATIC_ONLY_NOT_INTEGRATED`**. This experiment never opens a
device, builds an app image, or exposes a flash command.

This closes the static shape of the missing Render-v2 edge between the
resident MicroQuickJS 16-slot mailbox and a supplied 100×310 RGB565
framebuffer. It does not change `F2JS` v1. Instead, `F2TF` v1 is a separately
versioned 1,375-byte companion asset bound to:

- generation 18;
- the exact weather `F2JS` package SHA-256;
- the exact frozen raster-base SHA-256 and CRC32;
- the exact target-facade contract SHA-256.

The asset contains 16 canonical target IDs, each target's x/y/width/height,
text/color/hidden property mask, slot indices, formatter, clipping rectangle,
alignment, scale, character cap, palette indices, and bounded literal-table
range. It also contains an eight-entry RGB565 palette and a sorted 39-glyph
5×7 font. Target records remain declarations in `F2JS`; only this companion
defines how committed integer slots become pixels.

Run the complete offline proof from the repository root:

```sh
node experiments/mquickjs-target-facade/verify.mjs
```

The verifier extracts the existing generation-18 weather raster base, checks
all companion identities, and renders one shared mailbox corpus through both
the JavaScript oracle and the freestanding C consumer. It requires pixel-exact
frames for initial offline/error state, negative temperatures, same-revision
timer freshness, last-good provider error, hidden state, and a newer revision.
Revision rollback, wrong generation, malformed packed ASCII/condition fields,
odd and mid-copy torn seqlocks, malformed metadata/CRC/slot/geometry, and a
pre-draw pixel-cap overflow all fail closed to the untouched restored base.

The C consumer performs no allocation, trigonometry, JavaScript, or I/O. It
accepts a caller-owned base, mailbox, framebuffer, and UI-thread token. Every
valid render restores all 31,000 base pixels, takes a bounded three-attempt
atomic snapshot, validates generation and monotonic applied weather revision,
formats all targets into fixed stack buffers, preflights every clipped overlay
write against the 4,096-pixel cap, and only then draws. A wrong-thread call
returns before touching the framebuffer.

The generated [`build/manifest.json`](build/manifest.json) is the exact proof
receipt. The current Xtensa object has 4,364 text bytes, 72 read-only-data
bytes, no writable globals, no undefined symbols, a 576-byte largest
compiler-reported frame, and a conservative 1,296-byte sum of all static
frames. Its timing number is explicitly analytic—not hardware evidence.

## Integration still required

The future package/profile extension must advertise
`targetFacade=weather-slot-target-facade-v1` and associate the companion by
generation plus exact `F2JS`, raster-base, and contract hashes. The stock UI
task must restore the admitted base and call this consumer against the resident
mailbox. Capability advertisement, host-RPC receipts/backpressure, lifecycle
wiring, device stack/timing telemetry, a physical SHA receipt, and soak/recovery
testing remain unproven. Until those exist, this asset must not be offered as a
pushable Input Lab target.
