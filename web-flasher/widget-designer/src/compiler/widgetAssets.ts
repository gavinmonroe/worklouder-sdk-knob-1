// Widget image assets live in the authoring file, not in device RAM.
//
// Authors reference them from HTML or CSS with a stable URL:
//   <img src="asset://cloud" alt="">
//   background-image: url("asset://sprites");
//
// The preview resolves those URLs to self-contained data: URLs. The existing
// capture pipeline then flattens static pixels into the LZSS base frame and
// dynamic pixels into exact RGB565 raster variants. Consequently the original
// PNG/JPEG/WebP is NEVER copied into F2UP alongside its decoded pixels.

export const WIDGET_ASSET_SCHEME = "asset://";
export const WIDGET_ASSET_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/u;
export const WIDGET_ASSET_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
] as const);
export const WIDGET_ASSET_MAX_BYTES = 2 * 1024 * 1024;
// Base64 adds 4/3 overhead in localStorage and .f1widget.json. Three MiB keeps
// a complete draft below common 5 MiB browser quotas with room for source.
export const WIDGET_ASSET_MAX_TOTAL_BYTES = 3 * 1024 * 1024;
export const WIDGET_ASSET_MAX_COUNT = 64;

export type WidgetAssetMimeType = (typeof WIDGET_ASSET_MIME_TYPES)[number];

export interface WidgetAsset {
  id: string;
  name: string;
  mimeType: WidgetAssetMimeType;
  /** Original compressed file bytes, canonical base64 without a data-URL prefix. */
  data: string;
  bytes: number;
  width: number;
  height: number;
}

export type WidgetAssetMap = Record<string, WidgetAsset>;

const ASSET_REF = /asset:\/\/([a-z][a-z0-9-]{0,47})/gu;
const RESERVED_IDS = new Set(["constructor", "prototype", "tostring", "valueof"]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function widgetAssetReference(id: string): string {
  invariant(WIDGET_ASSET_ID_PATTERN.test(id) && !RESERVED_IDS.has(id.toLowerCase()),
    `Invalid widget asset id "${id}".`);
  return `${WIDGET_ASSET_SCHEME}${id}`;
}

export function widgetAssetDataUrl(asset: WidgetAsset): string {
  return `data:${asset.mimeType};base64,${asset.data}`;
}

export function widgetAssetTotalBytes(assets: WidgetAssetMap): number {
  return Object.values(assets).reduce((sum, asset) => sum + asset.bytes, 0);
}

export function referencedWidgetAssetIds(...sources: string[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    ASSET_REF.lastIndex = 0;
    for (const match of source.matchAll(ASSET_REF)) ids.add(match[1]);
  }
  return [...ids].sort();
}

/** Replace only known asset URLs. Unknown references stay visible so the
 * diagnostics layer can name them instead of turning them into broken data. */
export function resolveWidgetAssetReferences(source: string, assets: WidgetAssetMap = {}): string {
  ASSET_REF.lastIndex = 0;
  return source.replace(ASSET_REF, (reference, id: string) => {
    const asset = Object.prototype.hasOwnProperty.call(assets, id) ? assets[id] : undefined;
    return asset ? widgetAssetDataUrl(asset) : reference;
  });
}

function decodedBase64Bytes(data: string): number {
  if (data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) return -1;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return data.length / 4 * 3 - padding;
}

export function validateWidgetAssets(value: unknown): WidgetAssetMap {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value),
    'Widget file "assets" must be an object when present.');
  const output: WidgetAssetMap = {};
  let total = 0;
  const entries = Object.entries(value as Record<string, unknown>);
  invariant(entries.length <= WIDGET_ASSET_MAX_COUNT,
    `Widget file has ${entries.length} assets; at most ${WIDGET_ASSET_MAX_COUNT} are supported.`);
  for (const [key, raw] of entries) {
    invariant(WIDGET_ASSET_ID_PATTERN.test(key) && !RESERVED_IDS.has(key.toLowerCase()),
      `Widget asset id "${key}" is invalid.`);
    invariant(raw !== null && typeof raw === "object" && !Array.isArray(raw),
      `Widget asset "${key}" must be an object.`);
    const record = raw as Record<string, unknown>;
    invariant(record.id === key, `Widget asset "${key}" has a mismatched id.`);
    invariant(typeof record.name === "string" && record.name.length > 0 && record.name.length <= 200,
      `Widget asset "${key}" has an invalid file name.`);
    invariant(typeof record.mimeType === "string" &&
      (WIDGET_ASSET_MIME_TYPES as readonly string[]).includes(record.mimeType),
    `Widget asset "${key}" must be PNG, JPEG, or WebP.`);
    invariant(typeof record.data === "string", `Widget asset "${key}" has no base64 data.`);
    const bytes = decodedBase64Bytes(record.data as string);
    invariant(bytes >= 1 && bytes <= WIDGET_ASSET_MAX_BYTES,
      `Widget asset "${key}" is empty, malformed, or exceeds ${WIDGET_ASSET_MAX_BYTES} bytes.`);
    invariant(record.bytes === bytes, `Widget asset "${key}" byte count does not match its data.`);
    invariant(Number.isInteger(record.width) && (record.width as number) >= 1 && (record.width as number) <= 8192 &&
      Number.isInteger(record.height) && (record.height as number) >= 1 && (record.height as number) <= 8192,
    `Widget asset "${key}" has invalid image dimensions.`);
    total += bytes;
    invariant(total <= WIDGET_ASSET_MAX_TOTAL_BYTES,
      `Widget assets exceed the ${WIDGET_ASSET_MAX_TOTAL_BYTES}-byte authoring limit.`);
    output[key] = {
      id: key,
      name: record.name as string,
      mimeType: record.mimeType as WidgetAssetMimeType,
      data: record.data as string,
      bytes,
      width: record.width as number,
      height: record.height as number,
    };
  }
  return output;
}

function slugAssetId(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/u, "");
  const slug = withoutExtension.toLowerCase().replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "").slice(0, 48);
  return /^[a-z]/u.test(slug) ? slug : `image-${slug || "asset"}`.slice(0, 48);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try { return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Could not decode image "${file.name}".`));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Read one browser File into the portable asset record. Existing identical
 * bytes are returned by id; name collisions get a stable numeric suffix. */
export async function importWidgetImageAsset(file: File, assets: WidgetAssetMap): Promise<WidgetAsset> {
  invariant((WIDGET_ASSET_MIME_TYPES as readonly string[]).includes(file.type),
    `"${file.name}" is ${file.type || "an unknown type"}; use PNG, JPEG, or WebP.`);
  invariant(file.size >= 1 && file.size <= WIDGET_ASSET_MAX_BYTES,
    `"${file.name}" is ${file.size.toLocaleString()} bytes; each image must be at most ` +
      `${WIDGET_ASSET_MAX_BYTES.toLocaleString()} bytes.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = bytesToBase64(bytes);
  const duplicate = Object.values(assets).find((asset) => asset.mimeType === file.type && asset.data === data);
  if (duplicate) return duplicate;
  invariant(Object.keys(assets).length < WIDGET_ASSET_MAX_COUNT,
    `A widget can attach at most ${WIDGET_ASSET_MAX_COUNT} images.`);
  invariant(widgetAssetTotalBytes(assets) + bytes.length <= WIDGET_ASSET_MAX_TOTAL_BYTES,
    `Adding "${file.name}" would exceed the ${WIDGET_ASSET_MAX_TOTAL_BYTES.toLocaleString()}-byte ` +
      `widget asset limit.`);
  const base = slugAssetId(file.name);
  let id = RESERVED_IDS.has(base.toLowerCase()) ? `${base.slice(0, 42)}-image` : base;
  for (let suffix = 2; Object.prototype.hasOwnProperty.call(assets, id); suffix += 1) {
    const tail = `-${suffix}`;
    id = `${base.slice(0, 48 - tail.length)}${tail}`;
  }
  const dimensions = await imageDimensions(file);
  return {
    id,
    name: file.name,
    mimeType: file.type as WidgetAssetMimeType,
    data,
    bytes: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
  };
}
