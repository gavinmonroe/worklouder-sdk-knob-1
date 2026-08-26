// ─────────────────────────────────────────────────────────────────────────────
// Thin, typed re-export of the SDK's target-facade contract oracle so `src/`
// can call the SAME decode/render the hardware path is proven against — no fork,
// no reimplementation. The Device-frame view renders through these two
// functions, which makes the on-screen raster the device output by construction.
//
// Two evaluation-order facts make this safe in the browser bundle:
//   1. contract.mjs builds its contract sha (createHash) and glyph/palette
//      TABLES (Buffer.from/concat) at MODULE-EVAL time. `../compat/install` is
//      imported FIRST here so the global `Buffer` exists before contract.mjs's
//      top-level body runs (ES imports evaluate depth-first, in order).
//   2. `node:crypto` is aliased to src/compat/node-crypto.ts in vite.config.mjs,
//      and vite's server.fs.allow lists the repo root, so the experiments/ path
//      resolves and reads.
//
// The path climbs four levels: src/compiler → src → widget-designer →
// web-flasher → repo root, then into experiments/. Kept as a re-export (not a
// direct import at every call site) so the awkward path lives in exactly one
// place and the oracle itself is never touched. contract.mjs is plain JS with no
// declarations; allowJs infers its export shapes, and the loose signatures below
// name only the fields these call sites pass — the runtime behaviour is the
// oracle's, unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import "../compat/install";
import * as contract from "../../../../experiments/mquickjs-target-facade/contract.mjs";

export interface OracleDecodeOptions {
  expectedGeneration?: number;
  expectedF2jsSha256?: string;
  expectedContractSha256?: string;
  baseFrame?: Uint16Array;
}

export interface OracleMailboxInput {
  sequence: number;
  sequenceAfter: number;
  slots: number[];
  admittedGeneration: number;
}

export interface OracleRenderArgs {
  decoded: unknown;
  baseFrame: Uint16Array;
  mailbox: OracleMailboxInput;
  state: { lastAppliedRevision: number };
  expectedGeneration?: number;
  ownerThreadToken?: number;
  currentThreadToken?: number;
}

export interface OracleRenderOutput {
  /** A TARGET_FACADE_RESULT value (0 = ok, 1 = hidden, else a gate). */
  result: number;
  /** The rendered RGB565 frame (31,000 pixels), valid on ok/hidden. */
  frame: Uint16Array;
  metrics: Record<string, number>;
}

export const decodeTargetFacadeAsset = contract.decodeTargetFacadeAsset as unknown as (
  value: Uint8Array,
  options?: OracleDecodeOptions,
) => unknown;

export const renderTargetFacadeHost = contract.renderTargetFacadeHost as unknown as (
  args: OracleRenderArgs,
) => OracleRenderOutput;

export const TARGET_FACADE_RESULT = contract.TARGET_FACADE_RESULT as Record<string, number>;

export const TARGET_FACADE_CANVAS = contract.TARGET_FACADE_CANVAS as {
  width: number;
  height: number;
  pixels: number;
  pixelFormat: string;
};
