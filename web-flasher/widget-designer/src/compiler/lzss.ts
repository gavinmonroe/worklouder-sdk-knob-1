// ─────────────────────────────────────────────────────────────────────────────
// LZSS codec for the compressed base frame, ported line-for-line from the
// keyboard pipeline (experiments/mquickjs-esp32s3-physical-canary/verify.mjs;
// experiments/mquickjs-weather2-facade/build.mjs is byte-identical to it).
//
// Wire format the device decompressor expects: a flag byte followed by eight
// cases, bit 0 first. A clear bit is one literal byte; a set bit is a 16-bit
// little-endian match code, `(length - 3) << 10 | (distance - 1)`, window
// 1024 bytes, match length 3..66.
//
// The encoder is deterministic greedy — candidates are scanned nearest-first
// and only a strictly longer match replaces the best, so ties resolve to the
// smallest distance. Re-encoding a decoded stream therefore reproduces the
// original bytes exactly, which is what lets tests pin the flashed asset
// byte-for-byte (test/lzss.test.ts). Do not "optimize" the search: a different
// tie-break or lazy matching would still decode correctly but break parity
// with every canary-built asset.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_BYTES = 1024;
const MIN_MATCH = 3;
const MAX_MATCH = 66;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function encodeLzss(bytes: Uint8Array): Uint8Array {
  const outputBytes: number[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const flagsAt = outputBytes.length;
    outputBytes.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && cursor < bytes.length; bit++) {
      let bestLength = 0;
      let bestDistance = 0;
      const first = Math.max(0, cursor - WINDOW_BYTES);
      for (let candidate = cursor - 1; candidate >= first; candidate--) {
        if (bytes[candidate] !== bytes[cursor]) continue;
        let length = 1;
        // candidate + length may run past cursor: overlapping matches are
        // legal and the decoder replays them byte-by-byte.
        while (length < MAX_MATCH && cursor + length < bytes.length &&
          bytes[candidate + length] === bytes[cursor + length]) length++;
        if (length >= MIN_MATCH && length > bestLength) {
          bestLength = length; bestDistance = cursor - candidate;
          if (length === MAX_MATCH) break;
        }
      }
      if (bestLength >= MIN_MATCH) {
        flags |= 1 << bit;
        const code = ((bestLength - MIN_MATCH) << 10) | (bestDistance - 1);
        outputBytes.push(code & 0xff, code >>> 8); cursor += bestLength;
      } else outputBytes.push(bytes[cursor++]);
    }
    outputBytes[flagsAt] = flags;
  }
  return Uint8Array.from(outputBytes);
}

/**
 * Decompress to exactly `expectedLength` bytes. Throws when the stream runs
 * out early (overrun), keeps going past `expectedLength` worth of input
 * (underrun of the length, "trailing bytes"), or a match reaches outside the
 * bytes produced so far.
 */
export function decodeLzss(bytes: Uint8Array, expectedLength: number): Uint8Array {
  invariant(Number.isInteger(expectedLength) && expectedLength >= 0,
    "LZSS expectedLength must be a non-negative integer.");
  const decoded = new Uint8Array(expectedLength);
  let source = 0; let destination = 0;
  while (destination < decoded.length) {
    invariant(source < bytes.length, "LZSS flags overrun.");
    const flags = bytes[source++];
    for (let bit = 1; bit <= 0x80 && destination < decoded.length; bit <<= 1) {
      if ((flags & bit) === 0) {
        invariant(source < bytes.length, "LZSS literal overrun.");
        decoded[destination++] = bytes[source++];
      } else {
        invariant(source + 2 <= bytes.length, "LZSS match code overrun.");
        const code = bytes[source] | (bytes[source + 1] << 8); source += 2;
        const distance = (code & 1023) + 1; const length = (code >>> 10) + MIN_MATCH;
        invariant(distance <= destination && length <= decoded.length - destination,
          "LZSS match escaped output.");
        // Must stay a byte loop: when distance < length the match reads bytes
        // this very copy just produced.
        for (let index = 0; index < length; index++) {
          decoded[destination] = decoded[destination - distance]; destination++;
        }
      }
    }
  }
  invariant(source === bytes.length, "LZSS trailing bytes.");
  return decoded;
}
