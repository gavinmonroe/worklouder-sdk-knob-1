/* Host oracle for the weather3 facade.
 *
 * `renderTargetFacadeHost` in experiments/mquickjs-target-facade/contract.mjs is
 * a tracked release source and is not edited here.  It reads *slot 15* as the
 * flags word for every target, which is only correct for assets in which every
 * target happens to name slot 15 as its flag slot (gen18 and weather2 both do).
 * The freestanding on-device consumer, target_facade.c `prepare_target`, reads
 * the flag word from a *per-target* slot:
 *
 *   format 1  -> slots[record[26]]   (the target's first declared slot)
 *   format 2  -> slots[15]
 *   format 9  -> slots[record[28]]   (its third declared slot)
 *   otherwise -> slots[record[27]]   (its second declared slot)
 *
 * The weather3 asset uses three different flag slots (12 label, 13 settings,
 * 15 weather), which is what lets the settings view blank the weather targets
 * and vice versa, so this module mirrors the C exactly and verify.mjs proves the
 * two agree pixel for pixel.  decodeTargetFacadeAsset() in contract.mjs already
 * validates per-target flag slots, and the facade contract SHA-256 does not
 * cover the flag-slot rule, so nothing about admission changes.
 */

import { TARGET_FACADE_RESULT } from "../mquickjs-target-facade/contract.mjs";

const CANVAS_WIDTH = 100;
const CANVAS_HEIGHT = 310;
const CANVAS_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT;

function pushBytes(output, value) { for (const byte of value) output.push(byte); }
function appendAscii(output, text) { for (const character of text) output.push(character.charCodeAt(0)); }
function tableValue(target, index) {
  const value = target.tables[index]; if (!value) throw new Error("target-table-index"); return value;
}
function uintText(value) { return Buffer.from(String(value >>> 0), "ascii"); }

function packedAscii(word) {
  const output = []; let ended = false;
  for (let shift = 0; shift < 32; shift += 8) {
    const byte = (word >>> shift) & 0xff;
    if (byte === 0) { ended = true; continue; }
    if (ended || (byte < 48 || byte > 57) && !(output.length === 0 && byte === 45)) {
      throw new Error("packed-ascii");
    }
    output.push(byte);
  }
  const text = Buffer.from(output).toString("ascii");
  if (!/^-?\d{1,3}$/u.test(text)) throw new Error("packed-ascii");
  const numeric = Number(text); if (numeric < -999 || numeric > 999) throw new Error("packed-ascii");
  return { bytes: Buffer.from(output), numeric };
}

/** Exactly target_facade.c `prepare_target`. */
export function prepare(target, slots) {
  const output = [];
  let hidden = false;
  let palette = target.palette0;
  if (target.format === 1) {
    const rootFlags = slots[target.slots[0]] >>> 0;
    if ((rootFlags & ~7) !== 0) throw new Error("flags");
    return Object.freeze({ bytes: Buffer.alloc(0), hidden: Boolean(rootFlags & 2), palette });
  }
  const flagSlot = target.format === 9 ? target.slots[2] : target.format === 2 ? 15 : target.slots[1];
  const flags = slots[flagSlot] >>> 0;
  if ((flags & ~7) !== 0) throw new Error("flags");
  const hasGood = Boolean(flags & 1);
  if (target.format === 2) pushBytes(output, tableValue(target, 0));
  else if (target.format === 3) {
    const freshness = slots[target.slots[0]];
    if (freshness < 0 || freshness > 4) throw new Error("freshness");
    pushBytes(output, tableValue(target, freshness));
    if (freshness !== 1) palette = target.palette1;
  } else if (target.format === 4) {
    if (!hasGood) appendAscii(output, "--");
    else pushBytes(output, packedAscii(slots[target.slots[0]] >>> 0).bytes);
    output.push(0xb0); pushBytes(output, tableValue(target, 0));
  } else if (target.format === 5 || target.format === 8) {
    if (!hasGood) pushBytes(output, tableValue(target, 16));
    else {
      const meta = slots[target.slots[0]] >>> 0;
      if (target.format === 5) {
        if ((meta & ~31) !== 0 || (meta & 15) > 7) throw new Error("current-meta");
        pushBytes(output, tableValue(target, (meta & 15) + ((meta & 16) ? 0 : 8)));
        if (!(meta & 16)) palette = target.palette1;
      } else {
        if ((meta & ~0x3f) !== 0 || (meta & 7) > 6 || ((meta >>> 3) & 15) > 7) throw new Error("day-meta");
        const condition = (meta >>> 3) & 15; pushBytes(output, tableValue(target, condition));
        if (condition >= 5) palette = target.palette1;
      }
    }
  } else if (target.format === 6) {
    if (!hasGood) appendAscii(output, "NO DATA");
    else {
      const age = slots[target.slots[0]];
      if (age < 0 || age > 604_800) throw new Error("age");
      const unit = age < 60 ? 0 : age < 3_600 ? 1 : 2;
      pushBytes(output, uintText(unit === 0 ? age : unit === 1 ? Math.floor(age / 60) :
        Math.floor(age / 3_600)));
      pushBytes(output, tableValue(target, unit));
    }
  } else if (target.format === 7) {
    if (!hasGood) pushBytes(output, tableValue(target, 7));
    else {
      const meta = slots[target.slots[0]] >>> 0;
      if ((meta & ~0x3f) !== 0 || (meta & 7) > 6 || ((meta >>> 3) & 15) > 7) throw new Error("day-meta");
      pushBytes(output, tableValue(target, meta & 7));
    }
  } else if (target.format === 9) {
    if (!hasGood) appendAscii(output, "--");
    else {
      const low = packedAscii(slots[target.slots[0]] >>> 0);
      const high = packedAscii(slots[target.slots[1]] >>> 0);
      if (low.numeric > high.numeric) throw new Error("temperature-order");
      pushBytes(output, low.bytes); output.push(0xb0); appendAscii(output, " ");
      pushBytes(output, high.bytes); output.push(0xb0);
    }
  } else if (target.format === 10) {
    const retry = slots[target.slots[0]];
    if (retry < 0 || retry > 86_400) throw new Error("retry");
    hidden = retry === 0;
    if (!hidden) {
      pushBytes(output, tableValue(target, 0)); pushBytes(output, uintText(retry));
      appendAscii(output, "S");
    }
  } else throw new Error("format");
  if (output.length > target.maxChars) throw new Error("text-overflow");
  return Object.freeze({ bytes: Buffer.from(output), hidden, palette });
}

/** Exactly target_facade.c `target_pixels`. */
function countOrDraw(frame, decoded, target, prepared, draw) {
  if (prepared.hidden || target.format === 1) return 0;
  const scale = target.scale; const fontHeight = 7 * scale;
  const textWidth = prepared.bytes.length ? prepared.bytes.length * 6 * scale - scale : 0;
  let x = target.x;
  if (target.align === 1) x += Math.floor((target.width - textWidth) / 2);
  else if (target.align === 2) x += target.width - textWidth;
  const y = target.y + Math.floor((target.height - fontHeight) / 2);
  let writes = 0;
  for (const code of prepared.bytes) {
    const glyph = decoded.glyphs.get(code); if (!glyph) throw new Error("missing-glyph");
    for (let column = 0; column < 5; column++) for (let row = 0; row < 7; row++) {
      if (((glyph.columns[column] >>> row) & 1) === 0) continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = x + column * scale + sx; const py = y + row * scale + sy;
        if (px < target.x || px >= target.x + target.width || py < target.y ||
            py >= target.y + target.height || px < 0 || px >= CANVAS_WIDTH || py < 0 ||
            py >= CANVAS_HEIGHT) continue;
        writes++;
        if (draw) frame[py * CANVAS_WIDTH + px] = decoded.palette[prepared.palette];
      }
    }
    x += glyph.advance * scale;
  }
  return writes;
}

/** Exactly target_facade.c `render_internal`. */
export function renderWeather3FacadeHost({ decoded, baseFrame, mailbox, state,
  expectedGeneration = 19, ownerThreadToken = 0x12345678,
  currentThreadToken = ownerThreadToken } = {}) {
  const frame = new Uint16Array(baseFrame);
  const metrics = { baseWrites: 0, overlayWrites: 0, formattedTargets: 0, sequenceAttempts: 0,
    appliedGeneration: 0, appliedRevision: state.lastAppliedRevision >>> 0 };
  if (currentThreadToken !== ownerThreadToken) {
    return { result: TARGET_FACADE_RESULT.wrongThread, frame: new Uint16Array(CANVAS_PIXELS), metrics };
  }
  metrics.baseWrites = CANVAS_PIXELS;
  metrics.sequenceAttempts = 1;
  if (!mailbox || (mailbox.sequence & 1) ||
      (mailbox.sequenceAfter ?? mailbox.sequence) !== mailbox.sequence) {
    return { result: TARGET_FACADE_RESULT.torn, frame, metrics };
  }
  const slots = mailbox.slots;
  if (!Array.isArray(slots) || slots.length !== 16 || !slots.every(Number.isInteger)) {
    return { result: TARGET_FACADE_RESULT.argument, frame, metrics };
  }
  if (decoded.header.generation !== expectedGeneration ||
      mailbox.admittedGeneration !== expectedGeneration) {
    return { result: TARGET_FACADE_RESULT.generation, frame, metrics };
  }
  const revision = slots[0] >>> 0;
  if (slots[0] < 0 || revision < (state.lastAppliedRevision >>> 0)) {
    return { result: TARGET_FACADE_RESULT.revision, frame, metrics };
  }
  let prepared;
  try { prepared = decoded.targets.map((target) => prepare(target, slots)); }
  catch { return { result: TARGET_FACADE_RESULT.format, frame, metrics }; }
  if (prepared[0].hidden) {
    state.lastAppliedRevision = revision; metrics.appliedGeneration = expectedGeneration;
    metrics.appliedRevision = revision;
    return { result: TARGET_FACADE_RESULT.hidden, frame, metrics };
  }
  let overlayWrites = 0;
  try {
    for (let index = 1; index < decoded.targets.length; index++) {
      overlayWrites += countOrDraw(frame, decoded, decoded.targets[index], prepared[index], false);
      metrics.formattedTargets++;
    }
  } catch { return { result: TARGET_FACADE_RESULT.format, frame, metrics }; }
  if (overlayWrites > decoded.header.maxOverlayWrites) {
    metrics.formattedTargets = 0; return { result: TARGET_FACADE_RESULT.overflow, frame, metrics };
  }
  for (let index = 1; index < decoded.targets.length; index++) {
    countOrDraw(frame, decoded, decoded.targets[index], prepared[index], true);
  }
  state.lastAppliedRevision = revision; metrics.overlayWrites = overlayWrites;
  metrics.appliedGeneration = expectedGeneration; metrics.appliedRevision = revision;
  return { result: TARGET_FACADE_RESULT.ok, frame, metrics };
}

/** Debug helper: the exact byte string each target would draw. */
export function describeFrame(decoded, slots) {
  return decoded.targets.map((target) => {
    try {
      const value = prepare(target, slots);
      return { id: target.id, text: value.bytes.toString("latin1"), hidden: value.hidden };
    } catch (error) { return { id: target.id, error: String(error.message) }; }
  });
}
