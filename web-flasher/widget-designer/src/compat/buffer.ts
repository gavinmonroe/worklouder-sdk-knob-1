// ─────────────────────────────────────────────────────────────────────────────
// Browser Buffer shim for the SDK's render-v2 compiler.
//
// Same reasoning as the node:crypto shim: the SDK modules are the code that
// actually produces packages the firmware accepts, so the Designer imports them
// unmodified rather than forking them. Node's Buffer is the other global they
// assume.
//
// This implements exactly the surface those modules use — enumerated from the
// source, not guessed:
//
//   Buffer.from / alloc / concat / byteLength / isView / isBuffer
//   read|write UInt16LE, UInt32LE, Int32LE, UInt8
//   subarray, copy, equals, fill, toString("hex"|"ascii"|"utf8"), length
//
// Anything outside that throws loudly rather than returning something subtly
// wrong, because a silent mismatch here becomes a package the device rejects.
// ─────────────────────────────────────────────────────────────────────────────

// Node's own Buffer has this exact conflict: its static from(value, encoding)
// is incompatible with Uint8Array.from(arrayLike, mapfn), which is why Node
// ships a hand-written declaration rather than extending the type. Extending is
// still right at runtime — code does `instanceof Uint8Array` and ArrayBuffer
// .isView() on these — so the static-side mismatch is suppressed deliberately.
// @ts-expect-error -- see above
export class BufferShim extends Uint8Array {
  private get view(): DataView {
    return new DataView(this.buffer, this.byteOffset, this.byteLength);
  }

  static alloc(size: number, fill = 0): BufferShim {
    const buffer = new BufferShim(size);
    if (fill !== 0) buffer.fill(fill);
    return buffer;
  }

  static allocUnsafe(size: number): BufferShim {
    return new BufferShim(size);
  }

  static from(value: any, encoding?: string | number, length?: number): BufferShim {
    if (typeof value === "string") {
      if (encoding === "hex") {
        const bytes = new BufferShim(value.length >> 1);
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.substr(i * 2, 2), 16);
        return bytes;
      }
      if (encoding === "base64") {
        const binary = atob(value);
        const bytes = new BufferShim(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      const encoded = new TextEncoder().encode(value);
      const bytes = new BufferShim(encoded.length);
      bytes.set(encoded);
      return bytes;
    }
    if (value instanceof ArrayBuffer) {
      // Node's Buffer.from(arrayBuffer, byteOffset?, length?) — the facade
      // oracle (contract.mjs) uses the three-argument form to re-window a
      // typed-array view. Ignoring the extra arguments silently wrapped the
      // WHOLE backing buffer, which surfaced as "Target facade CRC is
      // invalid" in the Device frame. Honor Node's exact semantics.
      const byteOffset = typeof encoding === "number" ? encoding : 0;
      const byteLength =
        typeof length === "number" ? length : value.byteLength - byteOffset;
      return new BufferShim(value, byteOffset, byteLength);
    }
    if (ArrayBuffer.isView(value)) {
      const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const bytes = new BufferShim(source.length);
      bytes.set(source);
      return bytes;
    }
    if (Array.isArray(value)) {
      const bytes = new BufferShim(value.length);
      bytes.set(value);
      return bytes;
    }
    throw new TypeError("Buffer.from received an unsupported value.");
  }

  static concat(list: Uint8Array[], totalLength?: number): BufferShim {
    const total = totalLength ?? list.reduce((sum, item) => sum + item.length, 0);
    const out = new BufferShim(total);
    let offset = 0;
    for (const item of list) {
      if (offset + item.length > total) {
        out.set(item.subarray(0, total - offset), offset);
        break;
      }
      out.set(item, offset);
      offset += item.length;
    }
    return out;
  }

  static byteLength(value: string | Uint8Array, encoding?: string): number {
    if (typeof value !== "string") return value.length;
    if (encoding === "hex") return value.length >> 1;
    return new TextEncoder().encode(value).length;
  }

  static isBuffer(value: unknown): boolean {
    return value instanceof BufferShim;
  }

  static isView(value: unknown): boolean {
    return ArrayBuffer.isView(value);
  }

  readUInt8(offset = 0): number { return this[offset]; }
  writeUInt8(value: number, offset = 0): number { this[offset] = value & 0xff; return offset + 1; }

  readUInt16LE(offset = 0): number { return this.view.getUint16(offset, true); }
  writeUInt16LE(value: number, offset = 0): number {
    this.view.setUint16(offset, value & 0xffff, true);
    return offset + 2;
  }

  readUInt32LE(offset = 0): number { return this.view.getUint32(offset, true); }
  writeUInt32LE(value: number, offset = 0): number {
    this.view.setUint32(offset, value >>> 0, true);
    return offset + 4;
  }

  readInt32LE(offset = 0): number { return this.view.getInt32(offset, true); }
  writeInt32LE(value: number, offset = 0): number {
    this.view.setInt32(offset, value | 0, true);
    return offset + 4;
  }

  /** Node returns a Buffer view sharing memory; so does this. */
  override subarray(start?: number, end?: number): BufferShim {
    const view = super.subarray(start, end);
    return new BufferShim(view.buffer, view.byteOffset, view.byteLength);
  }

  /** Node's signature: copy(target, targetStart, sourceStart, sourceEnd). */
  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const slice = super.subarray(sourceStart, sourceEnd);
    target.set(slice, targetStart);
    return slice.length;
  }

  /**
   * Node: write(string, offset?, length?, encoding?) — but it also accepts
   * write(string, offset, encoding), which the SDK uses as
   * binary.write("F2EP", 0, "ascii"). Treating that encoding as `length` made
   * the count NaN and wrote nothing, producing a package with a missing magic
   * that only the device would have caught.
   */
  write(text: string, offset = 0, lengthOrEncoding?: number | string, maybeEncoding = "utf8"): number {
    const length = typeof lengthOrEncoding === "number" ? lengthOrEncoding : undefined;
    const encoding = typeof lengthOrEncoding === "string" ? lengthOrEncoding : maybeEncoding;
    const bytes =
      encoding === "ascii" || encoding === "latin1" || encoding === "binary"
        ? Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff)
        : new TextEncoder().encode(text);
    const count = Math.min(length ?? bytes.length, bytes.length, this.length - offset);
    this.set(bytes.subarray(0, count), offset);
    return count;
  }

  /** Node's slice() shares memory like subarray, unlike Array.prototype.slice. */
  override slice(start?: number, end?: number): BufferShim {
    return this.subarray(start, end);
  }

  indexOf(search: string | number | Uint8Array, byteOffset = 0): number {
    const needle =
      typeof search === "number"
        ? Uint8Array.of(search & 0xff)
        : typeof search === "string"
          ? new TextEncoder().encode(search)
          : search;
    if (needle.length === 0) return byteOffset;
    outer: for (let i = Math.max(0, byteOffset); i + needle.length <= this.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) if (this[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  equals(other: Uint8Array): boolean {
    if (other.length !== this.length) return false;
    for (let i = 0; i < this.length; i += 1) if (this[i] !== other[i]) return false;
    return true;
  }

  override toString(encoding: string = "utf8", start = 0, end = this.length): string {
    const slice = super.subarray(start, end);
    if (encoding === "hex") {
      let hex = "";
      for (const byte of slice) hex += byte.toString(16).padStart(2, "0");
      return hex;
    }
    if (encoding === "base64") {
      let binary = "";
      for (const byte of slice) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    if (encoding === "ascii" || encoding === "latin1" || encoding === "binary") {
      let text = "";
      for (const byte of slice) text += String.fromCharCode(byte);
      return text;
    }
    if (encoding === "utf8" || encoding === "utf-8") return new TextDecoder().decode(slice);
    throw new TypeError(`Buffer shim does not implement the ${encoding} encoding.`);
  }
}

/** Install on globalThis so SDK modules that reference bare `Buffer` resolve. */
export function installBufferShim(): void {
  if (!(globalThis as any).Buffer) (globalThis as any).Buffer = BufferShim;
}

export default BufferShim;
