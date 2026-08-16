import { createHash } from "node:crypto";

const SCENE_BRAND = Symbol("renderer-v1-validated-f1sc");
const BUNDLE_BRAND = Symbol("renderer-v1-validated-f1sb");

export const RENDERER_V1 = Object.freeze({
  width: 100,
  height: 310,
  strideBytes: 200,
  pixelBytes: 2,
  framebufferBytes: 62_000,
  tickMs: 100,
  slotCount: 3,
  bottomEncoderId: 1,
  maxSceneBytes: 4096,
  descriptor: Object.freeze({
    word0: 0x00001219, // LVGL v9 magic 0x19, RGB565 color format 0x12.
    word1: 0x01360064, // height 310, width 100.
    word2: 0x000000c8, // RGB565 stride 200.
    dataBytes: 62_000,
  }),
});

export const RENDERER_V1_RASTER = Object.freeze({
  magic: "F1RA",
  version: 1,
  headerBytes: 64,
  recordBytes: 8,
  pixelFormatRgb565Le: 1,
  maxFrames: 60,
  maxSceneBytes: 128 * 1024,
  maxThreeSlotFlashBytes: 3 * 128 * 1024,
  runtimePixelBytes: RENDERER_V1.framebufferBytes,
  runtimeDescriptorBytes: 48, // Two identities point at one pixel buffer.
});

function assertBufferMagic(input, magic, label) {
  if (!Buffer.isBuffer(input) || input.length < 8 || input.subarray(0, 4).toString("ascii") !== magic) {
    throw new Error(`${label} must be a validated ${magic} binary record.`);
  }
}

/**
 * Hardware-free adapter for the strict compiler decoder. It deliberately does
 * not parse CSS or infer fields omitted by F1SC v1. `renderInto` represents the
 * already-decoded F1SB preview/atlas contract and must fill exactly one bounded
 * RGB565 framebuffer.
 */
export function admitRendererV1Scene({ sceneBinary, tickCount, renderInto }) {
  assertBufferMagic(sceneBinary, "F1SC", "Scene");
  if (sceneBinary.length > RENDERER_V1.maxSceneBytes) {
    throw new Error(`F1SC record exceeds ${RENDERER_V1.maxSceneBytes} bytes.`);
  }
  if (!Number.isInteger(tickCount) || tickCount < 1 || tickCount > 65_535) {
    throw new Error("F1SC/F1SB tick count must be in 1..65535.");
  }
  if (typeof renderInto !== "function") {
    throw new TypeError("A validated F1SB render adapter is required.");
  }
  return Object.freeze({
    [SCENE_BRAND]: true,
    sceneBinary: Buffer.from(sceneBinary),
    tickCount,
    renderInto,
  });
}

function parseRasterFrames(input) {
  assertBufferMagic(input, RENDERER_V1_RASTER.magic, "Raster scene");
  if (input.length < RENDERER_V1_RASTER.headerBytes || input[4] !== RENDERER_V1_RASTER.version ||
      input[5] !== RENDERER_V1_RASTER.pixelFormatRgb565Le) {
    throw new Error("F1RA version/header is unsupported.");
  }
  const width = input.readUInt16LE(6);
  const height = input.readUInt16LE(8);
  const frameCount = input.readUInt16LE(10);
  const cadenceMs = input.readUInt16LE(12);
  const cadenceReserved = input.readUInt16LE(14);
  const loopDurationMs = input.readUInt32LE(16);
  const keyframeInterval = input.readUInt16LE(20);
  const tileWidth = input[22];
  const tileHeight = input[23];
  if (width !== RENDERER_V1.width || height !== RENDERER_V1.height ||
      frameCount < 1 || frameCount > RENDERER_V1_RASTER.maxFrames || cadenceMs < RENDERER_V1.tickMs ||
      cadenceMs % RENDERER_V1.tickMs !== 0 || cadenceReserved !== 0 ||
      loopDurationMs !== frameCount * cadenceMs || keyframeInterval > 60 ||
      tileWidth < 1 || tileWidth > 32 || tileHeight < 1 || tileHeight > 32 ||
      input.readUInt32LE(24) !== input.length || input.readUInt32LE(28) !== RENDERER_V1.framebufferBytes ||
      input.length > RENDERER_V1_RASTER.maxSceneBytes) {
    throw new Error("F1RA header violates the renderer-v1 admission contract.");
  }
  const expectedDigest = input.subarray(32, 64);
  const actualDigest = createHash("sha256").update(input.subarray(64)).digest();
  if (!actualDigest.equals(expectedDigest)) throw new Error("F1RA payload SHA-256 failed.");
  let cursor = RENDERER_V1_RASTER.headerBytes;
  const frames = [];
  const pixels = width * height;
  const tileColumns = Math.ceil(width / tileWidth);
  const tileRows = Math.ceil(height / tileHeight);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (cursor + RENDERER_V1_RASTER.recordBytes > input.length) {
      throw new Error(`F1RA frame ${frameIndex} header is truncated.`);
    }
    const type = input[cursor];
    const reserved = input[cursor + 1];
    const itemCount = input.readUInt16LE(cursor + 2);
    const payloadBytes = input.readUInt32LE(cursor + 4);
    const start = cursor + RENDERER_V1_RASTER.recordBytes;
    const end = start + payloadBytes;
    if (reserved !== 0 || end > input.length || (frameIndex === 0 && type !== 0) ||
        (keyframeInterval > 0 && frameIndex % keyframeInterval === 0 && type !== 0)) {
      throw new Error(`F1RA frame ${frameIndex} record is invalid.`);
    }
    cursor = start;
    if (type === 0) {
      if (itemCount !== 0 || payloadBytes !== RENDERER_V1.framebufferBytes) {
        throw new Error(`F1RA frame ${frameIndex} full payload is invalid.`);
      }
      frames.push(Object.freeze({ type, full: Object.freeze({ start, bytes: payloadBytes }) }));
      cursor = end;
    } else if (type === 1) {
      if (payloadBytes !== itemCount * 4) throw new Error(`F1RA frame ${frameIndex} pixel payload is invalid.`);
      const items = [];
      let previousOffset = -1;
      for (let item = 0; item < itemCount; item += 1) {
        const offset = input.readUInt16LE(cursor);
        if (offset <= previousOffset || offset >= pixels) throw new Error("F1RA pixel offsets are invalid or unordered.");
        items.push(Object.freeze({ offset, color: input.readUInt16LE(cursor + 2) }));
        previousOffset = offset; cursor += 4;
      }
      frames.push(Object.freeze({ type, items: Object.freeze(items) }));
    } else if (type === 2) {
      const spans = [];
      let previousEnd = 0;
      for (let item = 0; item < itemCount; item += 1) {
        if (cursor + 4 > end) throw new Error("F1RA span header is truncated.");
        const offset = input.readUInt16LE(cursor);
        const length = input.readUInt16LE(cursor + 2);
        cursor += 4;
        const bytes = length * 2;
        if (length === 0 || offset < previousEnd || offset + length > pixels || cursor + bytes > end) {
          throw new Error("F1RA span range is invalid or unordered.");
        }
        spans.push(Object.freeze({ offset, length, start: cursor, bytes }));
        cursor += bytes; previousEnd = offset + length;
      }
      frames.push(Object.freeze({ type, spans: Object.freeze(spans) }));
    } else if (type === 3) {
      const tiles = [];
      let previousTile = -1;
      for (let item = 0; item < itemCount; item += 1) {
        if (cursor + 2 > end) throw new Error("F1RA tile header is truncated.");
        const tile = input.readUInt16LE(cursor); cursor += 2;
        if (tile <= previousTile || tile >= tileColumns * tileRows) {
          throw new Error("F1RA tile indices are invalid or unordered.");
        }
        const x = tile % tileColumns * tileWidth;
        const y = Math.floor(tile / tileColumns) * tileHeight;
        const actualWidth = Math.min(tileWidth, width - x);
        const actualHeight = Math.min(tileHeight, height - y);
        const bytes = actualWidth * actualHeight * 2;
        if (cursor + bytes > end) throw new Error("F1RA tile pixels are truncated.");
        tiles.push(Object.freeze({ tile, x, y, width: actualWidth, height: actualHeight, start: cursor, bytes }));
        cursor += bytes; previousTile = tile;
      }
      frames.push(Object.freeze({ type, tiles: Object.freeze(tiles) }));
    } else {
      throw new Error(`Unsupported F1RA frame mode ${type}.`);
    }
    if (cursor !== end) throw new Error(`F1RA frame ${frameIndex} payload has trailing bytes.`);
  }
  if (cursor !== input.length) throw new Error("F1RA has trailing records beyond frameCount.");
  return Object.freeze({
    frameCount,
    cadenceMs,
    loopDurationMs,
    keyframeInterval,
    tileWidth,
    tileHeight,
    frames: Object.freeze(frames),
  });
}

function applyRasterFrame(binary, framebuffer, frame) {
  if (frame.type === 0) {
    binary.copy(framebuffer, 0, frame.full.start, frame.full.start + frame.full.bytes);
  } else if (frame.type === 1) {
    for (const { offset, color } of frame.items) framebuffer.writeUInt16LE(color, offset * 2);
  } else if (frame.type === 2) {
    for (const span of frame.spans) {
      binary.copy(framebuffer, span.offset * 2, span.start, span.start + span.bytes);
    }
  } else {
    for (const tile of frame.tiles) {
      let source = tile.start;
      for (let row = 0; row < tile.height; row += 1) {
        const destination = ((tile.y + row) * RENDERER_V1.width + tile.x) * 2;
        const rowBytes = tile.width * 2;
        binary.copy(framebuffer, destination, source, source + rowBytes);
        source += rowBytes;
      }
    }
  }
}

export function admitRendererV1Raster(sceneBinary) {
  const binary = Buffer.from(sceneBinary);
  const raster = parseRasterFrames(binary);
  const durationTicks = Math.max(1, Math.ceil(raster.loopDurationMs / RENDERER_V1.tickMs));
  return Object.freeze({
    [SCENE_BRAND]: true,
    kind: "F1RA",
    sceneBinary: binary,
    tickCount: durationTicks,
    raster,
    renderInto(framebuffer, { tick }) {
      const elapsedMs = tick * RENDERER_V1.tickMs % raster.loopDurationMs;
      const frameIndex = Math.min(raster.frameCount - 1, Math.floor(elapsedMs / raster.cadenceMs));
      let base = frameIndex;
      while (base > 0 && raster.frames[base].type !== 0) base -= 1;
      if (raster.frames[base].type !== 0) throw new Error("F1RA frame has no full keyframe base.");
      for (let index = base; index <= frameIndex; index += 1) {
        applyRasterFrame(binary, framebuffer, raster.frames[index]);
      }
    },
  });
}

function admitSlotBundle({ bundleBinary, bundleMagic, scenes, activeSlot = 0, producerGeneration = 0 }) {
  assertBufferMagic(bundleBinary, bundleMagic, "Bundle");
  if (!Array.isArray(scenes) || scenes.length !== RENDERER_V1.slotCount ||
      scenes.some((scene) => scene !== null && scene?.[SCENE_BRAND] !== true)) {
    throw new Error(`${bundleMagic} must expose exactly three admitted-or-empty widget slots.`);
  }
  const populatedSlots = scenes.flatMap((scene, slot) => scene === null ? [] : [slot]);
  if (populatedSlots.length === 0 || !Number.isInteger(activeSlot) || !populatedSlots.includes(activeSlot)) {
    throw new Error(`${bundleMagic} activeSlot must identify one populated slot.`);
  }
  return Object.freeze({
    [BUNDLE_BRAND]: true,
    bundleMagic,
    bundleBinary: Buffer.from(bundleBinary),
    scenes: Object.freeze([...scenes]),
    activeSlot,
    producerGeneration,
    populatedSlots: Object.freeze(populatedSlots),
  });
}

/** Backward-compatible admission boundary for the semantic F1SB bundle. */
export function admitRendererV1Bundle({ bundleBinary, scenes, activeSlot = 0 }) {
  return admitSlotBundle({ bundleBinary, bundleMagic: "F1SB", scenes, activeSlot });
}

/** Admit the SDK's strict semantic-only decodeSceneBundle result. */
export function admitRendererV1DecodedBundle(decodedBundle, { semanticRenderers = {} } = {}) {
  if (decodedBundle?.format !== "framer-scene-bundle-v1" || !Buffer.isBuffer(decodedBundle.binary) ||
      !Array.isArray(decodedBundle.slots) || decodedBundle.slots.length < 1 ||
      decodedBundle.slots.length > RENDERER_V1.slotCount) {
    throw new Error("Renderer requires a strictly decoded F1SB v1 bundle.");
  }
  const scenes = [null, null, null];
  for (const slot of decodedBundle.slots) {
    if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= RENDERER_V1.slotCount ||
        !Buffer.isBuffer(slot.sceneBinary) || !Buffer.isBuffer(slot.atlasBinary)) {
      throw new Error("Decoded F1SB slot shape is invalid.");
    }
    if (slot.sceneBinary.subarray(0, 4).toString("ascii") !== "F1SC" ||
        slot.atlasBinary.subarray(0, 4).toString("ascii") !== "F1GA") {
      throw new Error(`F1SB slot ${slot.index} is not F1SC+F1GA.`);
    }
    const adapter = semanticRenderers[slot.index];
    if (!adapter) throw new Error(`F1SB semantic slot ${slot.index} has no validated runtime adapter.`);
    scenes[slot.index] = admitRendererV1Scene({
      sceneBinary: slot.sceneBinary,
      tickCount: adapter.tickCount,
      renderInto: adapter.renderInto,
    });
  }
  return admitRendererV1Bundle({
    bundleBinary: decodedBundle.binary,
    scenes,
    activeSlot: decodedBundle.activeSlot,
  });
}

/** Admit the SDK's canonical heterogeneous decodeWidgetBundle (F1WB) result. */
export function admitRendererV1DecodedWidgetBundle(decodedBundle, { semanticRenderers = {} } = {}) {
  if (decodedBundle?.format !== "framer-widget-bundle-v1" || !Buffer.isBuffer(decodedBundle.binary) ||
      !Number.isInteger(decodedBundle.generation) || decodedBundle.generation < 0 ||
      decodedBundle.generation > 0xffffffff || !Array.isArray(decodedBundle.slots) ||
      decodedBundle.slots.length < 1 || decodedBundle.slots.length > RENDERER_V1.slotCount) {
    throw new Error("Renderer requires a strictly decoded F1WB v1 bundle.");
  }
  const scenes = [null, null, null];
  for (const slot of decodedBundle.slots) {
    if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= RENDERER_V1.slotCount ||
        slot.index !== scenes.findIndex((scene) => scene === null)) {
      throw new Error("Decoded F1WB slots must be unique and contiguous from slot zero.");
    }
    if (slot.kind === "raster" && Buffer.isBuffer(slot.animationBinary)) {
      scenes[slot.index] = admitRendererV1Raster(slot.animationBinary);
      continue;
    }
    if (slot.kind !== "semantic" || !Buffer.isBuffer(slot.sceneBinary) || !Buffer.isBuffer(slot.atlasBinary) ||
        slot.sceneBinary.subarray(0, 4).toString("ascii") !== "F1SC" ||
        slot.atlasBinary.subarray(0, 4).toString("ascii") !== "F1GA") {
      throw new Error(`F1WB slot ${slot.index} payload does not match its declared kind.`);
    }
    const adapter = semanticRenderers[slot.index];
    if (!adapter) throw new Error(`F1WB semantic slot ${slot.index} has no validated runtime adapter.`);
    scenes[slot.index] = admitRendererV1Scene({
      sceneBinary: slot.sceneBinary,
      tickCount: adapter.tickCount,
      renderInto: adapter.renderInto,
    });
  }
  return admitSlotBundle({
    bundleBinary: decodedBundle.binary,
    bundleMagic: "F1WB",
    scenes,
    activeSlot: decodedBundle.activeSlot,
    producerGeneration: decodedBundle.generation,
  });
}

function signedEncoderDelta(delta) {
  const value = Number(delta) & 0xff;
  return value >= 0x80 ? value - 0x100 : value;
}

export class RendererV1Runtime {
  #bundle;
  #pendingApply = null;
  #active = false;
  #owner = null;
  #image = null;
  #uiThread = null;
  #clockTick = 0;
  #dirty = true;
  #bundleGeneration = 0;
  #frameGeneration = 0;
  #descriptorIdentity = 0;
  #framebuffer = Buffer.alloc(RENDERER_V1.framebufferBytes);

  constructor(bundle, { currentSlot = bundle?.activeSlot } = {}) {
    if (bundle?.[BUNDLE_BRAND] !== true) throw new Error("Renderer requires one admitted widget bundle.");
    if (!Number.isInteger(currentSlot) || currentSlot < 0 || currentSlot >= RENDERER_V1.slotCount) {
      throw new Error("Current scene slot must be 0..2.");
    }
    this.#bundle = bundle;
    this.currentSlot = currentSlot;
    this.slotRevisions = [0, 0, 0];
  }

  get active() { return this.#active; }
  get bundleGeneration() { return this.#bundleGeneration; }
  get frameGeneration() { return this.#frameGeneration; }
  get clockTick() { return this.#clockTick; }
  get framebuffer() { return Buffer.from(this.#framebuffer); }
  get widget() {
    return Object.freeze({
      width: RENDERER_V1.width,
      height: RENDERER_V1.height,
      strideBytes: RENDERER_V1.strideBytes,
      dataBytes: RENDERER_V1.framebufferBytes,
      descriptorIdentity: this.#descriptorIdentity,
      owner: this.#owner,
      image: this.#image,
    });
  }

  attach({ owner, image, uiThread }) {
    if (this.#active || owner == null || image == null || uiThread == null) {
      throw new Error("Renderer attach requires one inactive runtime and non-null owner/image/UI-thread tokens.");
    }
    this.#owner = owner;
    this.#image = image;
    this.#uiThread = uiThread;
    this.#active = true;
    this.#clockTick = 0;
    this.#dirty = true;
    return this.widget;
  }

  detach({ owner }) {
    if (!this.#active || owner !== this.#owner) return false;
    // The LVGL root owns child deletion. These are borrowed handles only.
    this.#active = false;
    this.#owner = null;
    this.#image = null;
    this.#uiThread = null;
    return true;
  }

  queueAtomicSceneApply(updates, { expectedGeneration = this.#bundleGeneration } = {}) {
    if (!Array.isArray(updates) || updates.length === 0 || updates.length > RENDERER_V1.slotCount) {
      throw new Error("Atomic apply requires one to three scene updates.");
    }
    if (expectedGeneration !== this.#bundleGeneration) throw new Error("Stale scene generation.");
    const seen = new Set();
    const admitted = updates.map(({ slot, scene, expectedRevision = this.slotRevisions[slot] }) => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= RENDERER_V1.slotCount || seen.has(slot)) {
        throw new Error("Atomic apply slots must be unique indices in 0..2.");
      }
      seen.add(slot);
      if (scene?.[SCENE_BRAND] !== true) throw new Error("Atomic apply accepts admitted widget scene records only.");
      if (expectedRevision !== this.slotRevisions[slot]) throw new Error(`Stale revision for slot ${slot}.`);
      return Object.freeze({ slot, scene });
    });
    // Publish only after every member validates; a failed call mutates nothing.
    this.#pendingApply = Object.freeze(admitted);
    return { queued: admitted.length, expectedGeneration };
  }

  queueAtomicBundleApply(bundle, { expectedGeneration = this.#bundleGeneration } = {}) {
    if (bundle?.[BUNDLE_BRAND] !== true) throw new Error("Atomic bundle apply requires an admitted widget bundle.");
    if (expectedGeneration !== this.#bundleGeneration) throw new Error("Stale scene generation.");
    this.#pendingApply = Object.freeze({ bundle });
    return { queued: bundle.populatedSlots.length, expectedGeneration };
  }

  handleEncoder({ encoderId, delta, fnPressed, inputAvailable = true } = {}) {
    if (!this.#active || encoderId !== RENDERER_V1.bottomEncoderId || !fnPressed || !inputAvailable) {
      return false;
    }
    const signed = signedEncoderDelta(delta);
    if (signed === 0) return false;
    const populated = this.#bundle.populatedSlots;
    const currentOrdinal = populated.indexOf(this.currentSlot);
    const ordinal = currentOrdinal < 0 ? 0 : currentOrdinal;
    this.currentSlot = signed > 0
      ? populated[(ordinal + 1) % populated.length]
      : populated[(ordinal + populated.length - 1) % populated.length];
    this.#clockTick = 0;
    this.#dirty = true;
    return true; // RAM only; the next UI tick performs all rendering/LVGL work.
  }

  tick100ms({ uiThread }) {
    if (!this.#active || uiThread !== this.#uiThread) return Object.freeze({ rendered: false, reason: "lifecycle" });
    if (this.#pendingApply?.bundle) {
      const replacement = this.#pendingApply.bundle;
      const populated = replacement.populatedSlots;
      this.currentSlot = populated.includes(this.currentSlot)
        ? this.currentSlot
        : populated[this.currentSlot % populated.length];
      this.#bundle = replacement;
      this.slotRevisions = replacement.scenes.map((scene, slot) =>
        scene === null ? 0 : this.slotRevisions[slot] + 1);
      this.#pendingApply = null;
      this.#bundleGeneration += 1;
      this.#clockTick = 0;
      this.#dirty = true;
    } else if (this.#pendingApply) {
      const scenes = [...this.#bundle.scenes];
      for (const { slot, scene } of this.#pendingApply) {
        scenes[slot] = scene;
        this.slotRevisions[slot] += 1;
      }
      this.#bundle = Object.freeze({
        [BUNDLE_BRAND]: true,
        bundleMagic: this.#bundle.bundleMagic,
        bundleBinary: this.#bundle.bundleBinary,
        scenes: Object.freeze(scenes),
        activeSlot: this.#bundle.activeSlot,
        producerGeneration: this.#bundle.producerGeneration,
        populatedSlots: Object.freeze(scenes.flatMap((scene, slot) => scene === null ? [] : [slot])),
      });
      this.#pendingApply = null;
      this.#bundleGeneration += 1;
      this.#clockTick = 0;
      this.#dirty = true;
    }

    const scene = this.#bundle.scenes[this.currentSlot];
    const renderedTick = this.#clockTick;
    try {
      scene.renderInto(this.#framebuffer, Object.freeze({
        tick: renderedTick,
        tickMs: RENDERER_V1.tickMs,
        width: RENDERER_V1.width,
        height: RENDERER_V1.height,
        strideBytes: RENDERER_V1.strideBytes,
      }));
    } catch (error) {
      this.#framebuffer.fill(0);
      this.#dirty = true;
      return Object.freeze({ rendered: false, reason: "scene", error });
    }
    if (this.#framebuffer.length !== RENDERER_V1.framebufferBytes) {
      throw new Error("Renderer framebuffer bound changed.");
    }
    this.#frameGeneration += 1;
    this.#descriptorIdentity ^= 1; // Two descriptors, one bounded pixel buffer.
    this.#dirty = false;
    this.#clockTick = (this.#clockTick + 1) % scene.tickCount;
    return Object.freeze({
      rendered: true,
      slot: this.currentSlot,
      tick: renderedTick,
      frameGeneration: this.#frameGeneration,
      descriptorIdentity: this.#descriptorIdentity,
    });
  }
}
