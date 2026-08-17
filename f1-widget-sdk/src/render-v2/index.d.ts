export type RenderV2EventKind = "tick.100ms" | "tick.1s" | "input.fn-bottom-knob" | "host.rpc";

export interface RenderV2Event {
  kind: RenderV2EventKind | 1 | 2 | 3 | 4;
  flags?: 0 | 1;
  id?: number;
  value?: number;
  sequence?: number;
}

export interface RenderV2Instruction {
  opcode: number | keyof typeof RENDER_V2_OPCODES;
  dstState?: number;
  eventField?: number | keyof typeof RENDER_V2_EVENT_FIELDS;
  imm?: number;
}

export interface RenderV2Program {
  readonly format: "framer-renderer-v2-event-program-v1";
  readonly sha256: string;
  readonly binary: Uint8Array;
  readonly bytecode: Uint8Array;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface RenderV2Prepared {
  readonly format: "framer-render-v2-prepared-v1";
  readonly scene: Record<string, any>;
  readonly sceneBinary: Uint8Array;
  readonly script: Record<string, any>;
  readonly runs: ReadonlyArray<Record<string, any>>;
  readonly logicalBindings: ReadonlyArray<Record<string, any>>;
  readonly programBase: Record<string, any>;
}

export interface RenderV2Linked extends Omit<RenderV2Prepared, "format"> {
  readonly format: "framer-render-v2-linked-v1";
  readonly atlas: Record<string, any>;
  readonly spec: Record<string, any>;
  readonly program: RenderV2Program;
  readonly renderSource: "semantic-f1sc" | "pre-rendered-rgb565";
  readonly baseFrame: Uint8Array;
  readonly budget: Readonly<{
    states: number; handlers: number; bindings: number; patchSets: number; variants: number;
    spans: number; pixelBytes: number; baseFrameBytes: number; programBytes: number;
  }>;
  readonly sha256: string;
}

export interface RenderV2ProgramInspection {
  readonly format: "framer-renderer-v2-event-program-v1";
  readonly version: 1;
  readonly sha256: string;
  readonly bytes: number;
  readonly structurallyAdmitted: true;
  readonly stateSlots: number;
  readonly handlers: ReadonlyArray<Readonly<{
    kind: RenderV2EventKind; kindId: number; matchId: number; instructions: number;
  }>>;
  readonly resources: Readonly<{
    handlers: number; instructions: number; bytecodeBytes: number; patchSets: number;
    variants: number; spans: number; pixelBytes: number; bindings: number;
  }>;
  readonly binary: Uint8Array;
}

export interface RenderV2Compatibility {
  readonly profileId: string;
  readonly deviceDeployable: boolean;
  readonly diagnostics: ReadonlyArray<Readonly<{ severity: "error"; code: string; message: string }>>;
  readonly packageBytes: number;
  readonly packageSha256: string;
  readonly requiredCapability: string;
}

export interface RenderV2Package {
  readonly format: "framer-render-v2-package-v1";
  readonly generation: number;
  readonly name: string;
  readonly sha256: string;
  readonly binary: Uint8Array;
  readonly f1wb: Uint8Array;
  readonly f2ep: Uint8Array;
  readonly baseFrame: Uint8Array;
  readonly bundle: Readonly<Record<string, any>>;
  readonly program: Readonly<{
    format: "F2EP"; offset: number; bytes: number; sha256: string; inspection: RenderV2ProgramInspection;
  }>;
  readonly budget: Readonly<Record<string, number>>;
  readonly execution: Readonly<{
    authoredJavaScript: "statically-compiled-safe-subset";
    deviceRuntime: "bounded-F2EP-v1";
    deviceEvaluatesJavaScript: false;
    deviceRunsJsdom: false;
  }>;
  readonly compatibility?: Readonly<{
    currentDevice: RenderV2Compatibility;
    structuralV1: RenderV2Compatibility;
  }>;
}

export interface RenderV2Compilation {
  readonly format: "framer-render-v2-compilation-v1";
  readonly sha256: string;
  readonly prepared: RenderV2Prepared;
  readonly linked: RenderV2Linked;
  readonly package: RenderV2Package;
  readonly manifest: Readonly<Record<string, any>>;
}

export class RenderV2CompileError extends Error {
  readonly diagnostics: ReadonlyArray<Record<string, any>>;
}

export const RENDER_V2_EVENT_KINDS: Readonly<Record<RenderV2EventKind, number>>;
export const RENDER_V2_EVENT_FLAGS: Readonly<{ FN: 1 }>;
export const RENDER_V2_EVENT_FIELDS: Readonly<Record<string, number>>;
export const RENDER_V2_OPCODES: Readonly<Record<string, number>>;
export const RENDER_V2_ABI_LIMITS: Readonly<Record<string, number>>;
export const RENDER_V2_PROGRAM_LIMITS: Readonly<Record<string, string | number>>;
export const RENDER_V2_PACKAGE_FORMAT: "framer-render-v2-package-v1";
export const RENDER_V2_CURRENT_DEVICE_PROFILE: Readonly<Record<string, any>>;
export const RENDER_V2_GENERIC_ADMISSION_PROFILE: Readonly<Record<string, any>>;
export const RENDER_V2_LZSS: Readonly<{
  codec: "lzss-1k-len3-66-v1";
  distanceBits: 10;
  distanceMaximum: 1024;
  lengthMinimum: 3;
  lengthMaximum: 66;
}>;
export const COUNTDOWN_HOST_EVENTS: Readonly<{ chordLevel: number; configure: number }>;
export const COUNTDOWN_INPUT_CAPABILITIES: Readonly<Record<string, any>>;

export interface CountdownConfig {
  chord?: string | string[];
  encoderId?: number;
  stepSeconds?: number;
  maxSeconds?: number;
  presetSeconds?: number;
}

export interface CountdownState {
  readonly format: "framer-render-v2-countdown-state-v1";
  readonly phase: "idle" | "editing" | "running" | "finished";
  readonly chordHeld: boolean;
  readonly draftSeconds: number;
  readonly remainingSeconds: number;
  readonly initialSeconds: number;
  readonly revision: number;
  readonly elapsedTicks: number;
}

export type CountdownEvent =
  | { kind: "chord"; chord: string | string[]; pressed: boolean }
  | { kind: "encoder"; encoderId: number; delta: number }
  | { kind: "tick.1s" };

export function normalizeCountdownConfig(config?: CountdownConfig): Readonly<Required<CountdownConfig> & { format: string }>;
export function createCountdownState(config?: CountdownConfig): CountdownState;
export function signedCountdownEncoderDelta(value: number): number;
export function reduceCountdown(state: CountdownState, event: CountdownEvent,
  config?: CountdownConfig): Readonly<{ state: CountdownState; consumed: boolean; reason: string }>;
export function formatCountdown(seconds: number): string;
export function countdownViewModel(state: CountdownState, config?: CountdownConfig): Readonly<Record<string, any>>;
export function renderCountdownRgb565(state: CountdownState, config?: CountdownConfig): Uint16Array;
export function countdownFrameBytes(frame: Uint16Array): Uint8Array;
export function encodeCountdownHostChord(pressed: boolean): Readonly<{
  method: "widget.v2.event"; params: Readonly<{ id: number; value: 0 | 1 }>;
}>;

export function encodeRenderV2Event(event: RenderV2Event): Uint8Array;
export function decodeRenderV2Event(binary: Uint8Array): Readonly<Required<Omit<RenderV2Event, "kind">> & { kind: number }>;
export function encodeRenderV2Instruction(instruction: RenderV2Instruction): Uint8Array;
export function decodeRenderV2Instruction(binary: Uint8Array): Readonly<{
  opcode: number; dstState: number; eventField: number; imm: number;
}>;
export function encodeRenderV2InstructionStream(instructions: RenderV2Instruction[]): Readonly<{
  binary: Uint8Array; sha256: string;
}>;
export function executeRenderV2Instructions(options: {
  instructions: Array<RenderV2Instruction | Uint8Array>;
  state: Int32Array;
  event: RenderV2Event | Uint8Array;
}): Int32Array;
export function parseRenderV2Script(source: string): Record<string, any>;
export function prepareRenderV2(options: { html: string; css: string; script: string; rootClass?: string }): RenderV2Prepared;
export function compileRenderV2Program(spec: Record<string, any>): RenderV2Program;
export function inspectRenderV2Program(binary: Uint8Array): RenderV2ProgramInspection;
export function compileRenderV2Widget(options: {
  html: string;
  css: string;
  script: string;
  rootClass?: string;
  name?: string;
  generation?: number;
  atlas?: Record<string, any>;
  atlasFactory?: (glyphs: ReadonlyArray<string>) => Record<string, any> | Promise<Record<string, any>>;
  programEncoder?: (spec: Record<string, any>) => RenderV2Program;
}): Promise<RenderV2Compilation>;
export function buildRenderV2Package(linked: RenderV2Linked,
  options?: { name?: string; generation?: number }): RenderV2Package;
export function decodeRenderV2Package(value: Uint8Array | { binary: Uint8Array }): RenderV2Package;
export function renderV2PackageAtGeneration(value: Uint8Array | RenderV2Package,
  generation: number): RenderV2Package;
export function assessRenderV2PackageCompatibility(value: Uint8Array | RenderV2Package,
  options?: { profile?: Readonly<Record<string, any>> }): RenderV2Compatibility;
export function createRenderV2PackageUpload(value: Uint8Array | RenderV2Package, options: {
  expectedGeneration: number;
  profile?: Readonly<Record<string, any>>;
}): Readonly<Record<string, any>>;
export function linkRenderV2(prepared: RenderV2Prepared, options: {
  atlas: Record<string, any>;
  programEncoder?: (spec: Record<string, any>) => RenderV2Program;
}): RenderV2Linked;
export function linkRenderV2Raster(prepared: RenderV2Prepared, options: {
  atlas: Record<string, any>;
  baseFrame: Uint8Array;
  bindingPatches: Readonly<Record<string, Readonly<{
    originPixel: number;
    divisor?: number;
    modulo?: number;
    variants: ReadonlyArray<ReadonlyArray<Readonly<{
      pixelOffset: number;
      colors: Uint16Array | ReadonlyArray<number>;
    }>>>;
  }>>>;
  programEncoder?: (spec: Record<string, any>) => RenderV2Program;
}): RenderV2Linked;
export function createRenderV2Runtime(linked: RenderV2Linked): Readonly<{
  dispatch(event: RenderV2Event | Uint8Array): Readonly<{
    frame: Uint8Array; state: Readonly<Record<string, number>>; activeSlot: number | null;
    changedPixels: number; generation: number;
  }>;
  readonly frame: Uint8Array;
}>;
export function encodeRenderV2Lzss(source: Uint8Array): Uint8Array;
export function decodeRenderV2Lzss(source: Uint8Array, outputBytes: number): Uint8Array;
