/* The exact LZSS codec the resident loader inflates with.  Byte-identical to
 * the encoder/decoder pair in
 * experiments/mquickjs-esp32s3-physical-canary/verify.mjs. */

const invariant = (ok, message) => { if (!ok) throw new Error(message); };

export function encodeLzss(bytes) {
  const outputBytes = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const flagsAt = outputBytes.length;
    outputBytes.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && cursor < bytes.length; bit++) {
      let bestLength = 0;
      let bestDistance = 0;
      const first = Math.max(0, cursor - 1024);
      for (let candidate = cursor - 1; candidate >= first; candidate--) {
        if (bytes[candidate] !== bytes[cursor]) continue;
        let length = 1;
        while (length < 66 && cursor + length < bytes.length &&
          bytes[candidate + length] === bytes[cursor + length]) length++;
        if (length >= 3 && length > bestLength) {
          bestLength = length; bestDistance = cursor - candidate;
          if (length === 66) break;
        }
      }
      if (bestLength >= 3) {
        flags |= 1 << bit;
        const code = ((bestLength - 3) << 10) | (bestDistance - 1);
        outputBytes.push(code & 0xff, code >>> 8); cursor += bestLength;
      } else outputBytes.push(bytes[cursor++]);
    }
    outputBytes[flagsAt] = flags;
  }
  return Buffer.from(outputBytes);
}

export function decodeLzss(bytes, outputBytes) {
  const decoded = Buffer.alloc(outputBytes);
  let source = 0; let destination = 0;
  while (destination < decoded.length) {
    invariant(source < bytes.length, "LZSS flags overrun.");
    const flags = bytes[source++];
    for (let bit = 1; bit <= 0x80 && destination < decoded.length; bit <<= 1) {
      if ((flags & bit) === 0) decoded[destination++] = bytes[source++];
      else {
        const code = bytes.readUInt16LE(source); source += 2;
        const distance = (code & 1023) + 1; const length = (code >>> 10) + 3;
        invariant(distance <= destination && length <= decoded.length - destination,
          "LZSS match escaped output.");
        for (let index = 0; index < length; index++) {
          decoded[destination] = decoded[destination - distance]; destination++;
        }
      }
    }
  }
  invariant(source === bytes.length, "LZSS trailing bytes.");
  return decoded;
}
