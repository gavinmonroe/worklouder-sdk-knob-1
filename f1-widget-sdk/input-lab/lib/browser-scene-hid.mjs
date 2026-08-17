import { FramerHidClient, requestFramerHid } from "../../../web-flasher/src/lib/framer-hid.js";

export const BROWSER_SCENE_RPC_PROTOCOL = "framer-widget-scene-rpc-v1";
export const BROWSER_SCENE_RPC_LIMITS = Object.freeze({ maxBundleBytes: 96 * 1024,
  chunkRawBytes: 3072, maxChunks: 32, generationRecoveryWindow: 64 });
export const BROWSER_RENDER_V2_PROFILE = Object.freeze({
  protocol: "framer-widget-scene-rpc-v1",
  renderV2Profile: "framer-f1-render-v2-structural-v1",
  packageFormat: "framer-render-v2-package-v1",
  maxBundleBytes: 96 * 1024,
  chunkRawBytes: 3072,
  maxChunks: 32,
});
export const BROWSER_RENDER_V2_BEGIN_RETRY = Object.freeze({ attempts: 4, delayMs: 50,
  totalWaitMs: 150 });

const METHODS = Object.freeze({ begin: "widget.scene.begin", write: "widget.scene.write",
  commit: "widget.scene.commit", abort: "widget.scene.abort",
  capabilities: "widget.scene.capabilities", renderV2Event: "widget.v2.event" });

function invariant(value, message, code) {
  if (!value) { const error = new Error(message); if (code) error.code = code; throw error; }
}

function statusOnly(response) {
  return response && typeof response === "object" && !Array.isArray(response) &&
    Object.keys(response).length === 1 && ["ok", "error"].includes(response.status);
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function base64(bytes) {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(output);
}

async function createUpload(input, expectedGeneration) {
  invariant(input instanceof Uint8Array && input.length >= 332 && input.length <= BROWSER_SCENE_RPC_LIMITS.maxBundleBytes,
    "Browser scene Push requires a bounded F1WB bundle.");
  invariant(new TextDecoder().decode(input.subarray(0, 4)) === "F1WB" && input[4] === 1 && input[6] === 3,
    "Browser scene Push requires one canonical three-slot F1WB v1 bundle.");
  const bytes = new Uint8Array(input);
  const generation = expectedGeneration + 1;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(8, generation, true);
  const sha256 = await sha256Hex(bytes);
  const totalChunks = Math.ceil(bytes.length / BROWSER_SCENE_RPC_LIMITS.chunkRawBytes);
  invariant(totalChunks >= 1 && totalChunks <= BROWSER_SCENE_RPC_LIMITS.maxChunks,
    "Browser scene Push exceeds the 32-chunk renderer cap.");
  const transactionId = `f1wb-${generation.toString(16).padStart(8, "0")}-${sha256.slice(0, 16)}`;
  const common = { protocol: BROWSER_SCENE_RPC_PROTOCOL, transactionId, expectedGeneration, generation,
    totalBytes: bytes.length, totalChunks, chunkRawBytes: BROWSER_SCENE_RPC_LIMITS.chunkRawBytes, sha256 };
  const chunks = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const offset = index * BROWSER_SCENE_RPC_LIMITS.chunkRawBytes;
    const chunk = bytes.slice(offset, Math.min(bytes.length, offset + BROWSER_SCENE_RPC_LIMITS.chunkRawBytes));
    chunks.push({ protocol: BROWSER_SCENE_RPC_PROTOCOL, transactionId, generation, index, offset,
      bytes: chunk.length, chunkSha256: await sha256Hex(chunk), data: base64(chunk) });
  }
  return Object.freeze({ manifest: Object.freeze(common), chunks: Object.freeze(chunks),
    commit: Object.freeze({ protocol: BROWSER_SCENE_RPC_PROTOCOL, transactionId, expectedGeneration,
      generation, totalBytes: bytes.length, totalChunks, sha256 }) });
}

function exactGenericCapabilities(value) {
  const keys = ["chunkRawBytes", "committedGeneration", "maxBundleBytes", "maxChunks", "packageFormat",
    "protocol", "renderV2Profile", "status"];
  invariant(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === keys.sort().join(",") && value.status === "ok" &&
    value.protocol === BROWSER_RENDER_V2_PROFILE.protocol &&
    value.renderV2Profile === BROWSER_RENDER_V2_PROFILE.renderV2Profile &&
    value.packageFormat === BROWSER_RENDER_V2_PROFILE.packageFormat &&
    value.maxBundleBytes === BROWSER_RENDER_V2_PROFILE.maxBundleBytes &&
    value.chunkRawBytes === BROWSER_RENDER_V2_PROFILE.chunkRawBytes &&
    value.maxChunks === BROWSER_RENDER_V2_PROFILE.maxChunks &&
    Number.isInteger(value.committedGeneration) && value.committedGeneration >= 0 &&
    value.committedGeneration < 0xffffffff,
  "Keyboard does not advertise the exact generic Render-v2 admission profile.",
  "RENDER_V2_DEVICE_ADMISSION_UNAVAILABLE");
  return Object.freeze({ ...value });
}

function validateBrowserRenderV2Package(input) {
  invariant(input instanceof Uint8Array && input.length >= 332 + 64 &&
    input.length <= BROWSER_RENDER_V2_PROFILE.maxBundleBytes,
  "Browser Render-v2 Push requires a bounded F1WB+F2EP package.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const ascii = (offset, length) => new TextDecoder().decode(input.subarray(offset, offset + length));
  invariant(ascii(0, 4) === "F1WB" && input[4] === 1 && input[5] === 3 && input[6] === 1 && input[7] === 0 &&
    view.getUint16(16, true) === 104 && view.getUint16(18, true) === 332,
  "Browser Render-v2 package requires one canonical active F1WB raster slot.");
  const f1wbBytes = view.getUint32(12, true);
  invariant(f1wbBytes === 62_404 && f1wbBytes + 64 <= input.length && input[20] === 1 && input[21] === 2 &&
    input[22] >= 1 && input[22] <= 16 && input[23] === 0 && view.getUint32(24, true) === 332 &&
    view.getUint32(28, true) === 62_072 && view.getUint32(32, true) === 0 && view.getUint32(36, true) === 0 &&
    input.subarray(124, 332).every((byte) => byte === 0),
  "Browser Render-v2 F1WB descriptor is not the canonical one-frame raster base.");
  const raster = 332;
  invariant(ascii(raster, 4) === "F1RA" && input[raster + 4] === 1 && input[raster + 5] === 1 &&
    view.getUint16(raster + 6, true) === 100 && view.getUint16(raster + 8, true) === 310 &&
    view.getUint16(raster + 10, true) === 1 && view.getUint32(raster + 24, true) === 62_072 &&
    view.getUint32(raster + 28, true) === 62_000 && input[raster + 64] === 0 &&
    input[raster + 65] === 0 && view.getUint16(raster + 66, true) === 0 &&
    view.getUint32(raster + 68, true) === 62_000,
  "Browser Render-v2 base is not one full 100x310 RGB565 frame.");
  const program = f1wbBytes;
  invariant(ascii(program, 4) === "F2EP" && input[program + 4] === 1 &&
    view.getUint32(program + 12, true) === input.length - program,
  "Browser Render-v2 F2EP does not consume the exact package remainder.");
  return f1wbBytes;
}

export async function createBrowserRenderV2Upload(input, expectedGeneration) {
  invariant(Number.isInteger(expectedGeneration) && expectedGeneration >= 0 && expectedGeneration < 0xffffffff,
    "Browser Render-v2 expected generation must be a uint32 below its maximum.");
  const f1wbBytes = validateBrowserRenderV2Package(input);
  const bytes = new Uint8Array(input);
  const generation = expectedGeneration + 1;
  new DataView(bytes.buffer, bytes.byteOffset, f1wbBytes).setUint32(8, generation, true);
  const sha256 = await sha256Hex(bytes);
  const totalChunks = Math.ceil(bytes.length / BROWSER_RENDER_V2_PROFILE.chunkRawBytes);
  invariant(totalChunks >= 1 && totalChunks <= BROWSER_RENDER_V2_PROFILE.maxChunks,
    "Browser Render-v2 Push exceeds the 32-chunk scene-store cap.");
  const transactionId = `f2pk-${generation.toString(16).padStart(8, "0")}-${sha256.slice(0, 16)}`;
  const common = Object.freeze({ protocol: BROWSER_RENDER_V2_PROFILE.protocol, transactionId,
    expectedGeneration, generation, totalBytes: bytes.length, totalChunks,
    chunkRawBytes: BROWSER_RENDER_V2_PROFILE.chunkRawBytes, sha256 });
  const chunks = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const offset = index * BROWSER_RENDER_V2_PROFILE.chunkRawBytes;
    const chunk = bytes.slice(offset, Math.min(bytes.length, offset + BROWSER_RENDER_V2_PROFILE.chunkRawBytes));
    chunks.push(Object.freeze({ protocol: BROWSER_RENDER_V2_PROFILE.protocol, transactionId, generation, index,
      offset, bytes: chunk.length, chunkSha256: await sha256Hex(chunk), data: base64(chunk) }));
  }
  return Object.freeze({ bytes, manifest: common, chunks: Object.freeze(chunks),
    commit: Object.freeze({ protocol: BROWSER_RENDER_V2_PROFILE.protocol, transactionId, expectedGeneration,
      generation, totalBytes: bytes.length, totalChunks, sha256 }) });
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BrowserFramerSceneClient {
  constructor({ hidClient, device, initialGeneration = 1 } = {}) {
    invariant(hidClient && typeof hidClient.call === "function", "Browser scene client requires an open Framer HID client.");
    this.hidClient = hidClient;
    this.device = device;
    this.committedGeneration = initialGeneration;
    this.indeterminate = false;
    this.renderV2Capabilities = null;
    this.operationQueue = Promise.resolve();
  }

  static async connect() {
    const device = await requestFramerHid();
    const hidClient = await new FramerHidClient(device).open();
    try { await hidClient.verifyVersion(); }
    catch (error) { await hidClient.close().catch(() => {}); throw error; }
    return new BrowserFramerSceneClient({ hidClient, device });
  }

  runExclusive(operation) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async close() { return this.runExclusive(() => this.hidClient.close()); }

  async probeRenderV2Capabilities({ force = false } = {}) {
    return this.runExclusive(() => this.#probeRenderV2Capabilities(force));
  }

  async queryRenderV2Capabilities(options = {}) { return this.probeRenderV2Capabilities(options); }

  async #probeRenderV2Capabilities(force) {
    if (!force && this.renderV2Capabilities) return this.renderV2Capabilities;
    const response = await this.hidClient.call(METHODS.capabilities,
      { protocol: BROWSER_RENDER_V2_PROFILE.protocol });
    this.renderV2Capabilities = exactGenericCapabilities(response);
    this.committedGeneration = this.renderV2Capabilities.committedGeneration;
    return this.renderV2Capabilities;
  }

  async pushBundle(bytes, options = {}) { return this.runExclusive(() => this.#pushBundle(bytes, options)); }

  async #pushBundle(bytes, { onProgress = null } = {}) {
    invariant(!this.indeterminate, "Prior browser scene commit is indeterminate; reconnect before another Push.");
    for (let recovery = 0; recovery <= BROWSER_SCENE_RPC_LIMITS.generationRecoveryWindow; recovery += 1) {
      const expectedGeneration = this.committedGeneration + recovery;
      const upload = await createUpload(bytes, expectedGeneration);
      let response = await this.hidClient.call(METHODS.begin, upload.manifest);
      invariant(statusOnly(response), "Scene begin returned an invalid response.", "SCENE_RPC_REJECTED");
      if (response.status === "error") {
        await wait(150);
        response = await this.hidClient.call(METHODS.begin, upload.manifest);
        invariant(statusOnly(response), "Scene begin returned an invalid retry response.", "SCENE_RPC_REJECTED");
        if (response.status === "error") continue;
      }
      let begun = true;
      try {
        onProgress?.({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
        for (const chunk of upload.chunks) {
          const acknowledged = await this.hidClient.call(METHODS.write, chunk);
          invariant(statusOnly(acknowledged) && acknowledged.status === "ok",
            `Scene chunk ${chunk.index} was rejected.`, "SCENE_RPC_REJECTED");
          onProgress?.({ stage: "uploading-chunks", current: chunk.index + 1, total: upload.chunks.length });
        }
        onProgress?.({ stage: "applying-on-keyboard" });
        let committed;
        try { committed = await this.hidClient.call(METHODS.commit, upload.commit); }
        catch (cause) { this.indeterminate = true; throw Object.assign(new Error(
          "Scene commit reply is indeterminate; reconnect before another Push.", { cause }),
        { code: "SCENE_COMMIT_INDETERMINATE" }); }
        invariant(statusOnly(committed) && committed.status === "ok", "Scene commit was rejected.", "SCENE_RPC_REJECTED");
        begun = false;
        this.committedGeneration = upload.commit.generation;
        return Object.freeze({ status: "webhid-canary-commit-acknowledged", hardwareAccess: true,
          proofBacked: false, uiHandoffVerified: false, generation: upload.commit.generation,
          sha256: upload.commit.sha256, bytes: upload.commit.totalBytes, chunks: upload.commit.totalChunks, slots: 3 });
      } catch (error) {
        if (begun && !this.indeterminate) await this.hidClient.call(METHODS.abort, { protocol: BROWSER_SCENE_RPC_PROTOCOL,
          transactionId: upload.manifest.transactionId, generation: upload.manifest.generation }).catch(() => {});
        throw error;
      }
    }
    throw Object.assign(new Error("Keyboard scene generation could not be recovered."), { code: "SCENE_RPC_REJECTED" });
  }

  async pushRenderV2Package(bytes, options = {}) {
    return this.runExclusive(() => this.#pushRenderV2Package(bytes, options));
  }

  async #pushRenderV2Package(bytes, { onProgress = null } = {}) {
    invariant(!this.indeterminate, "Prior browser scene commit is indeterminate; reconnect before another Push.");
    const capabilities = await this.#probeRenderV2Capabilities(true);
    const upload = await createBrowserRenderV2Upload(bytes, capabilities.committedGeneration);
    let begun = false;
    try {
      let began;
      for (let attempt = 0; attempt < BROWSER_RENDER_V2_BEGIN_RETRY.attempts; attempt += 1) {
        began = await this.hidClient.call(METHODS.begin, upload.manifest);
        invariant(statusOnly(began), "Render-v2 scene begin returned an invalid response.", "SCENE_RPC_REJECTED");
        if (began.status === "ok") break;
        if (attempt + 1 < BROWSER_RENDER_V2_BEGIN_RETRY.attempts) {
          await wait(BROWSER_RENDER_V2_BEGIN_RETRY.delayMs);
        }
      }
      invariant(began?.status === "ok",
        "Keyboard stayed busy for the Render-v2 update. Keep screen ID 26 visible so its UI tick can release the prior widget, then try Push again.",
        "RENDER_V2_SCENE_BUSY");
      begun = true;
      onProgress?.({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
      for (const chunk of upload.chunks) {
        const acknowledged = await this.hidClient.call(METHODS.write, chunk);
        invariant(statusOnly(acknowledged) && acknowledged.status === "ok",
          `Render-v2 scene chunk ${chunk.index} was rejected.`, "SCENE_RPC_REJECTED");
        onProgress?.({ stage: "uploading-chunks", current: chunk.index + 1, total: upload.chunks.length });
      }
      onProgress?.({ stage: "applying-on-keyboard" });
      let committed;
      try { committed = await this.hidClient.call(METHODS.commit, upload.commit); }
      catch (cause) { this.indeterminate = true; throw Object.assign(new Error(
        "Render-v2 commit reply is indeterminate; reconnect before another Push.", { cause }),
      { code: "SCENE_COMMIT_INDETERMINATE" }); }
      invariant(statusOnly(committed) && committed.status === "ok",
        "Render-v2 scene commit was rejected.", "SCENE_RPC_REJECTED");
      begun = false;
      this.committedGeneration = upload.commit.generation;
      this.renderV2Capabilities = Object.freeze({ ...capabilities, committedGeneration: this.committedGeneration });
      return Object.freeze({ status: "render-v2-package-commit-acknowledged", hardwareAccess: true,
        profile: capabilities.renderV2Profile, packageFormat: capabilities.packageFormat,
        generation: upload.commit.generation, sha256: upload.commit.sha256,
        bytes: upload.commit.totalBytes, chunks: upload.commit.totalChunks });
    } catch (error) {
      if (begun && !this.indeterminate) await this.hidClient.call(METHODS.abort, {
        protocol: BROWSER_RENDER_V2_PROFILE.protocol, transactionId: upload.manifest.transactionId,
        generation: upload.manifest.generation }).catch(() => {});
      throw error;
    }
  }

  async sendRenderV2HostEvent(id, value) {
    return this.runExclusive(async () => {
      await this.#probeRenderV2Capabilities(false);
      invariant(Number.isInteger(id) && id >= 1 && id <= 0xffff,
        "Render-v2 host event id must be in 1..65535.");
      invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
        "Render-v2 host event value must be an int32.");
      const response = await this.hidClient.call(METHODS.renderV2Event, { id, value });
      invariant(statusOnly(response) && response.status === "ok",
        "Render-v2 host event was rejected.", "RENDER_V2_HOST_EVENT_REJECTED");
      return Object.freeze({ status: "render-v2-host-event-acknowledged", id, value });
    });
  }
}

export function browserHidAvailable() {
  return globalThis.isSecureContext === true && typeof navigator !== "undefined" && "hid" in navigator;
}
