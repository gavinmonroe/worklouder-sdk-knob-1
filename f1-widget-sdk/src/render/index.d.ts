export interface CssSceneProfile {
  width: number;
  height: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  top: number;
  fontPixelSize: number;
  glyphMaskBitsPerPixel: 1;
  tickMs: number;
  maxCells: number;
  maxAnimationConfigs: number;
  maxKeyframeStops: number;
  maxGlowRadius: number;
  maxSceneBytes?: number;
  maxPersistentBytes?: number;
  maxDirtyPixelsPerTick?: number;
}

export const MATRIX_DEVICE_PROFILE: Readonly<CssSceneProfile>;

export class CssCompileError extends Error {
  diagnostics: Array<{ severity: "warning" | "error"; code: string; message: string;
    selector?: string; property?: string }>;
}

export function compileCssWidget(options: {
  html: string;
  css: string;
  rootClass?: string;
  profile?: CssSceneProfile;
}): { scene: Record<string, unknown>; binary: Buffer };

export function encodeCssScene(scene: Record<string, unknown>): Buffer;

export function decodeCssScene(binary: Uint8Array, options?: { profile?: CssSceneProfile }): Record<string, any>;
export function validateCssScene(scene: Record<string, any>, options?: { profile?: CssSceneProfile }): true;

export function sampleCssCell(scene: Record<string, any>, cellIndex: number, elapsedMs: number): {
  rgba?: { r: number; g: number; b: number; a: number };
  color565: number;
  glowRadius: number;
  progress: number | null;
};
export function sampleCssCellAtTick(scene: Record<string, any>, cellIndex: number, elapsedTick: number): {
  rgba?: { r: number; g: number; b: number; a: number };
  color565: number;
  glowRadius: number;
  progress: number | null;
  interpolationQ16?: number;
};

export interface GlyphAtlas {
  format: "framer-glyph-atlas-v1";
  glyphs?: readonly string[];
  width: number;
  height: number;
  rowStride: number;
  bitsPerPixel: 1;
  masks: readonly Buffer[];
  binary: Buffer;
  sha256: string;
  source?: unknown;
  testOnly?: boolean;
}

export function buildGlyphAtlas(options: {
  glyphs: string[];
  width?: number;
  height?: number;
  rasterizeGlyph: (glyph: string, metrics: { glyphId: number; width: number; height: number; rowStride: number }) => Uint8Array;
  source?: unknown;
  testOnly?: boolean;
}): GlyphAtlas;
export function createDeterministicTestGlyphAtlas(glyphs: string[], options?: Record<string, unknown>): GlyphAtlas;
export function rasterizeGlyphAtlasWithMagick(glyphs: string[], options?: Record<string, unknown>): Promise<GlyphAtlas>;
export function decodeGlyphAtlas(binary: Uint8Array): GlyphAtlas & { glyphCount: number };
export function glyphMaskPixel(atlas: GlyphAtlas, glyphId: number, x: number, y: number): 0 | 1;
export const PINNED_HIRAGINO_ATLAS_SOURCE: Readonly<Record<string, unknown>>;

export function renderCssSceneRgb565(scene: Record<string, any>, atlas: GlyphAtlas, elapsedTick: number): Uint16Array;
export function rgb565FrameToRgba8888(frame: Uint16Array, options?: { width?: number; height?: number }): Uint8ClampedArray;

export const SCENE_SLOT_CAPACITY: 3;
export function encodeSceneBundle(options: Record<string, any>): { format: string; binary: Buffer; sha256: string; [key: string]: any };
export function decodeSceneBundle(binary: Uint8Array): { format: string; binary: Buffer; sha256: string; [key: string]: any };

export interface RasterAnimationResult {
  format: "framer-raster-animation-v1";
  binary: Buffer;
  sha256: string;
  width: 100;
  height: 310;
  fps: number;
  cadenceMs: number;
  loopDurationMs: number;
  stats: Record<string, any>;
  [key: string]: any;
}
export function encodeRasterAnimation(options: {
  frames: Uint16Array[];
  width?: 100;
  height?: 310;
  fps?: number;
  loopDurationMs?: number;
  maxBytes?: number;
  keyframeInterval?: number;
  tileWidth?: number;
  tileHeight?: number;
}): RasterAnimationResult;
export function fitRasterAnimation(options: Parameters<typeof encodeRasterAnimation>[0] & {
  maxBytes: number;
  maxFrames?: number;
  minFrames?: number;
}): RasterAnimationResult & { selectedFrameIndices: number[]; requestedFrameCount: number; reduced: boolean };
export function decodeRasterAnimation(binary: Uint8Array): Omit<RasterAnimationResult, "stats"> & {
  frames: Uint16Array[];
  modes: Array<"full" | "pixels" | "spans" | "tiles">;
};
export function rgba8888ToRgb565Frame(rgba: Uint8Array, options?: {
  width?: 100; height?: 310; background?: { r: number; g: number; b: number };
}): Uint16Array;
export const RASTER_ANIMATION_LIMITS: Readonly<Record<string, number>>;

export function encodeWidgetBundle(options: Record<string, any>): { format: string; binary: Buffer; sha256: string; [key: string]: any };
export function decodeWidgetBundle(binary: Uint8Array): { format: string; binary: Buffer; sha256: string; slots: any[]; [key: string]: any };
export const WIDGET_BUNDLE_KINDS: readonly ["semantic", "raster"];
