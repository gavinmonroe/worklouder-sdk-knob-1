export const INPUT_LAB_RENDER_V2_MAX_EVENTS = 64;

const EVENT_KINDS = new Set(["tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc"]);

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function int32(value, label) {
  const number = Number(value);
  invariant(Number.isInteger(number) && number >= -0x80000000 && number <= 0x7fffffff,
    `${label} must be an integer from -2147483648 to 2147483647.`);
  return number;
}

export function parseRenderV2HostRpcId(value) {
  const text = String(value ?? "").trim();
  invariant(/^(?:0x[0-9a-f]{1,8}|\d{1,10})$/iu.test(text),
    "Host RPC ID must be decimal or 0x-prefixed hexadecimal.");
  const id = Number(text);
  invariant(Number.isInteger(id) && id >= 1 && id <= 0xffff, "Host RPC ID must be in 1..65535.");
  return id;
}

export function createRenderV2PreviewEvent({ kind, value = 1, id = 0, sequence } = {}) {
  invariant(EVENT_KINDS.has(kind), `Unsupported Render v2 preview event ${kind}.`);
  const normalized = { kind, flags: 0, id: 0, value: int32(value, "Event value"),
    sequence: Number(sequence) };
  invariant(Number.isInteger(normalized.sequence) && normalized.sequence >= 1 && normalized.sequence <= 0xffffffff,
    "Event sequence must be in 1..4294967295.");
  if (kind === "input.fn-bottom-knob") {
    normalized.flags = 1;
    normalized.id = 1;
    invariant(normalized.value !== 0, "Knob delta cannot be zero.");
  } else if (kind === "host.rpc") {
    normalized.id = parseRenderV2HostRpcId(id);
  }
  return Object.freeze(normalized);
}

export function appendRenderV2PreviewEvent(events, event) {
  invariant(Array.isArray(events), "Render v2 event history must be an array.");
  invariant(events.length < INPUT_LAB_RENDER_V2_MAX_EVENTS,
    `Render v2 preview accepts at most ${INPUT_LAB_RENDER_V2_MAX_EVENTS} events; reset the simulation to continue.`);
  return Object.freeze([...events, event]);
}

export function createRenderV2ApiSource(source, events) {
  invariant(source && typeof source === "object", "Render v2 source is missing.");
  const renderMode = source.mode ?? source.renderMode ?? "auto";
  invariant(["auto", "semantic", "raster"].includes(renderMode),
    "Render v2 mode must be auto, semantic, or raster.");
  const request = { html: String(source.html ?? ""), css: String(source.css ?? ""),
    script: String(source.script ?? ""), rootClass: "render-v2", renderMode,
    ...(source.name ? { name: String(source.name).slice(0, 32) } : {}) };
  if (events !== undefined) {
    invariant(Array.isArray(events) && events.length <= INPUT_LAB_RENDER_V2_MAX_EVENTS,
      `Render v2 preview accepts at most ${INPUT_LAB_RENDER_V2_MAX_EVENTS} events.`);
    request.events = events;
  }
  return request;
}

function decodeBase64(value) {
  invariant(typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/u.test(value),
    "Render v2 compiler returned an invalid frame encoding.");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeRenderV2Frame(value) {
  const bytes = decodeBase64(value);
  invariant(bytes.byteLength === 62_000,
    `Render v2 compiler returned ${bytes.byteLength} frame bytes; expected exactly 62000.`);
  return bytes;
}

export function renderV2FrameToRgba(value) {
  const bytes = value instanceof Uint8Array ? value : decodeRenderV2Frame(value);
  invariant(bytes.byteLength === 62_000, "Render v2 RGB565 frame must be exactly 62000 bytes.");
  const rgba = new Uint8ClampedArray(100 * 310 * 4);
  for (let pixel = 0; pixel < 31_000; pixel += 1) {
    const color = bytes[pixel * 2] | (bytes[pixel * 2 + 1] << 8);
    const red = color >>> 11;
    const green = color >>> 5 & 0x3f;
    const blue = color & 0x1f;
    const offset = pixel * 4;
    rgba[offset] = red << 3 | red >>> 2;
    rgba[offset + 1] = green << 2 | green >>> 4;
    rgba[offset + 2] = blue << 3 | blue >>> 2;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

export function drawRenderV2Frame(canvas, frameBase64) {
  invariant(canvas?.width === 100 && canvas?.height === 310 && typeof canvas.getContext === "function",
    "Render v2 preview requires the native 100x310 canvas.");
  const context = canvas.getContext("2d");
  const rgba = renderV2FrameToRgba(frameBase64);
  context.putImageData(new ImageData(rgba, 100, 310), 0, 0);
}

export function normalizeRenderV2Result(result) {
  invariant(result && typeof result === "object" && result.mode === "render-v2",
    "Input Lab compiler returned an invalid Render v2 result.");
  invariant(typeof result.sha256 === "string" && /^[0-9a-f]{64}$/u.test(result.sha256),
    "Input Lab compiler returned an invalid Render v2 package hash.");
  invariant(Number.isInteger(result.packageBytes) && result.packageBytes > 0,
    "Input Lab compiler returned an invalid Render v2 package size.");
  decodeRenderV2Frame(result.frameBase64);
  invariant(result.state && typeof result.state === "object" && !Array.isArray(result.state),
    "Input Lab compiler returned invalid Render v2 state.");
  invariant(result.budget && typeof result.budget === "object" && !Array.isArray(result.budget),
    "Input Lab compiler returned invalid Render v2 budget data.");
  return result;
}
