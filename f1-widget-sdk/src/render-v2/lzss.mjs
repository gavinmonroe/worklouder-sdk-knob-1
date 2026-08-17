const DISTANCE_BITS = 10;
const DISTANCE_MAX = 1 << DISTANCE_BITS;
const LENGTH_MAX = (1 << (16 - DISTANCE_BITS)) + 2;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function bytes(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be bytes.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export const RENDER_V2_LZSS = Object.freeze({
  codec: "lzss-1k-len3-66-v1",
  distanceBits: DISTANCE_BITS,
  distanceMaximum: DISTANCE_MAX,
  lengthMinimum: 3,
  lengthMaximum: LENGTH_MAX,
});

export function encodeRenderV2Lzss(value) {
  const source = bytes(value, "Render-v2 LZSS source");
  const output = [];
  let cursor = 0;
  while (cursor < source.length) {
    const flagsIndex = output.length;
    output.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && cursor < source.length; bit += 1) {
      let bestLength = 0;
      let bestDistance = 0;
      const first = Math.max(0, cursor - DISTANCE_MAX);
      for (let candidate = cursor - 1; candidate >= first; candidate -= 1) {
        if (source[candidate] !== source[cursor]) continue;
        let length = 1;
        while (length < LENGTH_MAX && cursor + length < source.length &&
          source[candidate + length] === source[cursor + length]) length += 1;
        if (length >= 3 && length > bestLength) {
          bestLength = length;
          bestDistance = cursor - candidate;
          if (length === LENGTH_MAX) break;
        }
      }
      if (bestLength >= 3) {
        flags |= 1 << bit;
        const code = ((bestLength - 3) << DISTANCE_BITS) | (bestDistance - 1);
        output.push(code & 0xff, code >>> 8);
        cursor += bestLength;
      } else output.push(source[cursor++]);
    }
    output[flagsIndex] = flags;
  }
  return Buffer.from(output);
}

export function decodeRenderV2Lzss(value, outputBytes) {
  const source = bytes(value, "Render-v2 LZSS stream");
  invariant(Number.isInteger(outputBytes) && outputBytes >= 0,
    "Render-v2 LZSS decoded length must be a nonnegative integer.");
  const output = Buffer.alloc(outputBytes);
  let cursor = 0;
  let target = 0;
  while (target < output.length) {
    invariant(cursor < source.length, "Render-v2 LZSS flags overran the stream.");
    const flags = source[cursor++];
    for (let bit = 1; bit <= 0x80 && target < output.length; bit <<= 1) {
      if ((flags & bit) === 0) {
        invariant(cursor < source.length, "Render-v2 LZSS literal overran the stream.");
        output[target++] = source[cursor++];
      } else {
        invariant(cursor + 2 <= source.length, "Render-v2 LZSS match overran the stream.");
        const code = source.readUInt16LE(cursor); cursor += 2;
        const distance = (code & (DISTANCE_MAX - 1)) + 1;
        const length = (code >>> DISTANCE_BITS) + 3;
        invariant(distance <= target && length <= output.length - target,
          "Render-v2 LZSS match escaped the decoded output.");
        for (let index = 0; index < length; index += 1) {
          output[target] = output[target - distance]; target += 1;
        }
      }
    }
  }
  invariant(cursor === source.length, "Render-v2 LZSS stream has trailing bytes.");
  return output;
}
