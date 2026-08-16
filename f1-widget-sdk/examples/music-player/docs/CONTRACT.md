# Host media contract

`host-media-snapshot-v1` is intentionally provider-neutral. A macOS bridge would implement one asynchronous method:

```js
const current = await adapter.getCurrentMedia();
```

It returns:

```js
{
  title: "Midnight Circuit",
  artist: "Static Bloom",
  durationMs: 240000,
  positionMs: 102000,
  albumArt: {
    format: "rgba8",
    width: 512,
    height: 512,
    pixels: Uint8Array
  }
}
```

The adapter owns provider access, permissions, compressed-image decoding, and stale/no-track behavior. The widget pipeline only accepts decoded RGBA8 so album color and output bytes do not vary with a system codec. Text is trimmed and bounded to 256 characters. Dimensions are bounded to 4096 per axis. Position is clamped to zero through duration. A zero duration produces zero progress.

The fixture adapter translates a JSON color grid into RGBA8. The separate `InputLocalhostMediaAdapter` is the real macOS source: it reuses Input's packaged Spotify/Apple Music/MediaRemote provider over the localhost debugger, bounds compressed artwork, and returns exact `80x80` RGBA8 or a deterministic fallback. It still implements this same provider-neutral contract.

## Deterministic main color

Pixels with alpha below 128 are ignored. Remaining colors are grouped into 4-bit-per-channel RGB buckets. If chromatic buckets account for at least five percent of opaque pixels, the most populated chromatic bucket wins; otherwise all buckets participate. Ties resolve by chroma and then the quantized bucket key. The returned RGB value is the rounded mean of the winning bucket.

This prevents a small black border from beating the album's repeated blue while retaining a stable neutral fallback. It is deliberately simpler and more reproducible than platform-dependent color APIs.

The background uses an asymmetric, edge-normalized elliptical radius centered behind the album art. Distances are normalized independently toward the left, right, top, and bottom boundaries. Smoothstep interpolation preserves a soft radial appearance while guaranteeing that every logical canvas edge reaches the same dark terminal color.

## Update identity

The host update key hashes title, artist, duration, raw album-art hash, and the integer progress bucket. The default bucket is one second. Polling can occur more frequently without packaging or proposing a device update until that key changes.
