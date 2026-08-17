import type {
  RenderV2Compilation,
  RenderV2Event,
  RenderV2Linked,
  RenderV2Package,
} from "framer-f1-research-widget-sdk/renderer-v2";

export type InputLabRenderMode = "auto" | "semantic" | "raster";
export type InputLabRenderer = "v1" | "v2";
export type InputLabRenderV2ResolvedMode = "semantic" | "raster";

export interface InputLabRenderV2Source {
  html: string;
  css: string;
  script: string;
  rootClass?: string;
  name?: string;
  generation?: number;
  renderMode?: InputLabRenderMode;
}

export interface InputLabRenderV2RasterSource
  extends Omit<InputLabRenderV2Source, "renderMode"> {}

export type InputLabRenderV2Event = RenderV2Event & {
  kind: "tick.100ms" | "tick.1s" | "input.fn-bottom-knob" | "host.rpc";
};

export interface InputLabRenderV2RasterProof {
  readonly format: "framer-render-v2-raster-proof-v1";
  readonly chromeProduct: string;
  readonly verificationModel: "exhaustive-cartesian-fresh-render" |
    "structural-isolation-plus-fresh-render-samples";
  readonly mutationIsolation: typeof INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION;
  readonly sampleCoverage: Readonly<{
    individualVariants: "all";
    pairwiseStates: "one deterministic alternate per binding pair";
    combinedStates: "one deterministic all-bindings alternate";
    exhaustiveCartesian: boolean;
    cartesianStates: number;
  }>;
  readonly structuralIsolation: Readonly<{
    format: "framer-render-v2-raster-structural-isolation-v1";
    targetBoxes: number;
    fixedTargetBoxes: true;
    htmlTargets: true;
    sizeContainment: true;
    layoutContainment: true;
    paintContainment: true;
    zeroOverflowClipMargin: true;
    safeAncestorEffects: true;
    disjointTargetBoxes: true;
    disjointBindingPatches: true;
    patchPixelsInsideTargetBoxes: true;
  }> | null;
  readonly freshRenders: number;
  readonly initialVariants: number;
  readonly individualVariants: number;
  readonly pairwiseStates: number;
  readonly combinedStates: number;
  readonly baseFrameSha256: string;
  readonly layoutSha256: string;
}

export interface InputLabRenderV2RasterCompilation extends RenderV2Compilation {
  readonly linked: RenderV2Linked & { readonly renderSource: "pre-rendered-rgb565" };
  readonly package: RenderV2Package;
  readonly rasterProof: InputLabRenderV2RasterProof;
}

export interface InputLabRenderV2Result {
  readonly format: "framer-input-lab-render-v2-compilation-v1";
  readonly mode: "render-v2";
  readonly renderMode: InputLabRenderV2ResolvedMode;
  readonly requestedRenderMode: InputLabRenderMode;
  readonly compilation: RenderV2Compilation | InputLabRenderV2RasterCompilation;
  readonly frame: Uint8Array;
  readonly state: Readonly<Record<string, number>>;
  readonly changedPixels: number;
  readonly generation: number;
  readonly eventsApplied: number;
}

export interface InputLabRenderV2PushStatus {
  readonly supported: boolean;
  readonly deviceDeployable: boolean;
  readonly activeProfile: string;
  readonly requiredProfile: string;
  readonly packageFormat: string;
  readonly reason: string | null;
  readonly diagnostics: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface SerializedInputLabRenderV2 {
  readonly format: "framer-input-lab-render-v2-compilation-v1";
  readonly mode: "render-v2";
  readonly renderMode: InputLabRenderV2ResolvedMode;
  readonly requestedRenderMode: InputLabRenderMode;
  readonly renderSource: "semantic-f1sc" | "pre-rendered-rgb565";
  readonly rasterProof: InputLabRenderV2RasterProof | null;
  readonly sha256: string;
  readonly packageBytes: number;
  readonly packageBase64: string;
  readonly programBytes: number;
  readonly programSha256: string;
  readonly baseFrameBase64: string;
  readonly frameBase64: string;
  readonly frameSha256: string;
  readonly state: Readonly<Record<string, number>>;
  readonly changedPixels: number;
  readonly generation: number;
  readonly eventsApplied: number;
  readonly budget: Readonly<Record<string, number>>;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly push: InputLabRenderV2PushStatus;
}

export interface RenderV2ChromiumMutation {
  readonly targetId: string;
  readonly textContent?: string;
  readonly color?: string;
}

export interface RenderV2ChromiumCase {
  readonly name: string;
  readonly mutations: ReadonlyArray<RenderV2ChromiumMutation>;
}

export interface RenderV2ChromiumCapturedCase extends RenderV2ChromiumCase {
  readonly layout: Readonly<Record<string, unknown>>;
  readonly targetStyles: Readonly<Record<string, Readonly<{
    tagName: string;
    namespaceURI: string;
    rect: readonly [number, number, number, number];
    contain: string;
    display: string;
    overflowClipMargin: string;
    filter: string;
    textShadow: string;
    fontKerning: string;
    fontVariantLigatures: string;
    fontVariantNumeric: string;
    direction: string;
    unicodeBidi: string;
    writingMode: string;
    ancestorEffects: ReadonlyArray<Readonly<{
      tagName: string;
      id: string;
      filter: string;
      backdropFilter: string;
      mixBlendMode: string;
    }>>;
  }>>>;
  readonly frame: Uint8Array;
}

export interface RenderV2ChromiumCaptureResult {
  readonly format: "framer-render-v2-chromium-captures-v1";
  readonly browser: Readonly<{ executable: string; product: string }>;
  readonly cases: ReadonlyArray<RenderV2ChromiumCapturedCase>;
}

export interface RenderV2ChromiumCaptureRequest {
  html: string;
  css: string;
  targets: ReadonlyArray<string>;
  cases: ReadonlyArray<RenderV2ChromiumCase>;
  signal?: AbortSignal;
}

export interface InputLabRenderV2RasterCaptureProvider {
  captureRenderV2Variants(
    request: RenderV2ChromiumCaptureRequest,
  ): Promise<RenderV2ChromiumCaptureResult>;
}

export interface InputLabRenderV2CompileOptions {
  atlasFactory?: (
    glyphs: ReadonlyArray<string>,
  ) => unknown | Promise<unknown>;
  captureProvider?: InputLabRenderV2RasterCaptureProvider;
}

export interface InputLabRenderV2RasterCompileOptions {
  captureProvider: InputLabRenderV2RasterCaptureProvider;
}

export interface InputLabRasterSettings {
  fps?: number;
  loopDurationMs?: number;
  maxFrames?: number;
  maxBytes?: number;
  interaction?: "none" | "hover";
}

export interface InputLabRasterCaptureRequest {
  html: string;
  css: string;
  settings?: InputLabRasterSettings;
  signal?: AbortSignal;
}

export interface InputLabRasterCaptureResult {
  readonly animation: Readonly<Record<string, any>> & { readonly binary: Uint8Array };
  readonly pngFrames: ReadonlyArray<string>;
  readonly settings: Readonly<Required<InputLabRasterSettings> & { cadenceMs: number }>;
  readonly browser: Readonly<{ executable: string; product: string }>;
  readonly capturedFrameCount: number;
}

export interface InputLabRasterCaptureProvider {
  capture(request: InputLabRasterCaptureRequest): Promise<InputLabRasterCaptureResult>;
}

export interface ChromiumRasterCaptureProviderOptions {
  chromePath?: string;
  expectedProduct?: string;
  spawnProcess?: (...args: any[]) => any;
  createWebSocket?: (endpoint: string) => any;
  limits?: Partial<Readonly<{
    startupTimeoutMs: number;
    connectTimeoutMs: number;
    commandTimeoutMs: number;
    jobTimeoutMs: number;
    shutdownGraceMs: number;
  }>>;
}

export class ChromiumRasterCaptureProvider
  implements InputLabRasterCaptureProvider, InputLabRenderV2RasterCaptureProvider {
  constructor(options?: ChromiumRasterCaptureProviderOptions);
  capture(request: InputLabRasterCaptureRequest): Promise<InputLabRasterCaptureResult>;
  captureRenderV2Variants(
    request: RenderV2ChromiumCaptureRequest,
  ): Promise<RenderV2ChromiumCaptureResult>;
}

export const INPUT_LAB_RENDER_V2_FORMAT: "framer-input-lab-render-v2-compilation-v1";
export const INPUT_LAB_RENDER_V2_MAX_EVENTS: 64;
export const INPUT_LAB_RENDER_V2_CAPABILITIES: Readonly<{
  compiler: true;
  simulator: true;
  packageFormat: "framer-render-v2-package-v1";
  genericAdmissionProfile: string;
  currentDeviceProfile: string;
  eventKinds: ReadonlyArray<InputLabRenderV2Event["kind"]>;
  keyboardKeyEvents: false;
  maxReplayEvents: 64;
  renderModes: ReadonlyArray<InputLabRenderMode>;
  chromiumRaster: Readonly<{
    supported: true;
    exactViewport: Readonly<{ width: 100; height: 310 }>;
    maxBindings: number;
    maxVariants: number;
    mutationIsolation: typeof INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION;
    userJavaScriptExecuted: false;
    layoutReflow: false;
  }>;
  deviceEvaluatesJavaScript: false;
  deviceRunsJsdom: false;
}>;
export const INPUT_LAB_RENDER_V2_RASTER_LIMITS: Readonly<{
  maxBindings: number;
  maxVariants: number;
  maxCases: number;
  maxTargetScalars: number;
}>;
export const INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION: Readonly<{
  format: "framer-render-v2-raster-mutation-isolation-v1";
  authoredMutations: readonly ["textContent", "style.color"];
  verificationModels: readonly ["exhaustive-cartesian-fresh-render",
    "structural-isolation-plus-fresh-render-samples"];
  rejectedCssFeatures: ReadonlyArray<string>;
}>;

export function compileInputLabRenderV2(
  source?: InputLabRenderV2Source,
  options?: InputLabRenderV2CompileOptions,
): Promise<InputLabRenderV2Result>;
export function compileInputLabRenderV2Raster(
  source?: InputLabRenderV2RasterSource,
  options?: InputLabRenderV2RasterCompileOptions,
): Promise<InputLabRenderV2RasterCompilation>;
export function replayInputLabRenderV2(
  compiled: InputLabRenderV2Result,
  events?: ReadonlyArray<InputLabRenderV2Event>,
): InputLabRenderV2Result;
export function simulateInputLabRenderV2(
  source?: InputLabRenderV2Source & { events?: ReadonlyArray<InputLabRenderV2Event> },
  options?: InputLabRenderV2CompileOptions,
): Promise<InputLabRenderV2Result>;
export function serializeInputLabRenderV2(
  value: InputLabRenderV2Result,
): SerializedInputLabRenderV2;

export const INPUT_LAB_CHROME: string | undefined;
export const PINNED_INPUT_LAB_CHROME_PRODUCT: string;
export const DEFAULT_RASTER_SETTINGS: Readonly<Required<InputLabRasterSettings>>;
export const CHROMIUM_CAPTURE_LIMITS: Readonly<Record<string, number>>;
export const RENDER_V2_CHROMIUM_CAPTURE_LIMITS: Readonly<{
  maxCases: number;
  maxMutationsPerCase: number;
  maxTargets: number;
  maxTextScalars: number;
}>;
export function sanitizeRasterDocument(input: {
  html: string;
  css: string;
  interaction?: "none" | "hover";
}): string;
export function requireRasterCaptureProvider<T extends InputLabRasterCaptureProvider>(provider: T): T;

export interface InputLabSceneSource {
  name?: string;
  html: string;
  css: string;
  mode?: InputLabRenderMode;
  settings?: InputLabRasterSettings;
}

export const INPUT_LAB_LIMITS: Readonly<{ htmlBytes: number; cssBytes: number }>;
export const INPUT_LAB_SEMANTIC_UNSUPPORTED: "INPUT_LAB_SEMANTIC_UNSUPPORTED";
export const HOSTED_GLYPH_CACHE_SHA256: string;
export function validateInputLabSource(source: InputLabSceneSource): Readonly<InputLabSceneSource>;
export function decodeHostedGlyphCache(bytes: Uint8Array, options?: { expectedSha256?: string }): unknown;
export function createInputLabGlyphAtlas(glyphs: ReadonlyArray<string>): Promise<unknown>;
export function compileInputLabScene(
  source: InputLabSceneSource,
  options?: { atlasFactory?: (glyphs: ReadonlyArray<string>) => unknown | Promise<unknown>; allowTestAtlas?: boolean },
): Promise<Readonly<Record<string, any>>>;
export function serializeInputLabCompilation(compilation: Readonly<Record<string, any>>): Readonly<Record<string, any>>;
export function compileInputLabBundle(options: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
export function compileInputLabWidgetBundle(options: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;

export function buildInputWlrpcSceneExpression(method: string, params: Record<string, unknown>): string;
export class InputWlrpcSceneTransport {
  constructor(options?: Readonly<Record<string, any>>);
  rpc(method: string, params: Record<string, unknown>): Promise<Readonly<Record<string, any>>>;
}

export interface InputLabSceneTransport {
  applySceneBundle(input: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
}
export const FRAMER_SCENE_HANDLER_PROOF_FORMAT: "framer-scene-handler-live-proof-v1";
export const FRAMER_SCENE_PUBLISHING_BLOCKER: Readonly<Record<string, any>>;
export const FRAMER_SCENE_HANDLER_CANDIDATES: ReadonlyArray<Readonly<Record<string, any>>>;
export const LIVE_PROVEN_FRAMER_SCENE_HANDLERS: ReadonlyArray<Readonly<Record<string, any>>>;
export class MockSceneTransport implements InputLabSceneTransport {
  readonly calls: Array<Readonly<Record<string, any>>>;
  activeSlot: number | null;
  applyScene(input: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
  applySceneBundle(input: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
}
export class FailClosedLiveSceneTransport implements InputLabSceneTransport {
  constructor(options?: Readonly<Record<string, any>>);
  applyScene(): Promise<never>;
  applySceneBundle(input: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
}
export class StatusOnlyCanarySceneTransport implements InputLabSceneTransport {
  constructor(options?: Readonly<Record<string, any>>);
  applyScene(): Promise<never>;
  applySceneBundle(input: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
}
export function requireSceneTransport<T extends InputLabSceneTransport>(transport: T): T;

export interface InputLabPreviewSlot extends InputLabSceneSource {
  readonly id: number;
  renderer: InputLabRenderer;
  script: string;
  eventConfig: Readonly<{ keyboardCode: string; keyboardRpcId: string }>;
  compiled: Readonly<Record<string, unknown>> | null;
}
export interface InputLabPreviewState {
  readonly version: 4;
  readonly activeSlot: number;
  readonly slots: ReadonlyArray<Readonly<InputLabPreviewSlot>>;
}
export interface InputLabStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const INPUT_LAB_STORAGE_KEY: "framer-f1-input-lab-v1";
export function makeInitialPreviewState(): InputLabPreviewState;
export class SavedPreviewStore {
  constructor(options: { storage: InputLabStorageAdapter; key?: string });
  load(): InputLabPreviewState;
  saveSlot(index: number, slot: Partial<InputLabPreviewSlot> & Pick<InputLabPreviewSlot, "html" | "css">): InputLabPreviewState;
  renameSlot(index: number, name: string): InputLabPreviewState;
  setActive(index: number): InputLabPreviewState;
}

export const BROWSER_RENDER_V2_BEGIN_RETRY: Readonly<{ attempts: number; delayMs: number; totalWaitMs: number }>;
export const BROWSER_RENDER_V2_PROFILE: Readonly<Record<string, string | number>>;
export const BROWSER_SCENE_RPC_LIMITS: Readonly<Record<string, number>>;
export function browserHidAvailable(): boolean;
export function createBrowserRenderV2Upload(input: Uint8Array, expectedGeneration: number): Promise<Readonly<Record<string, any>>>;

export interface InputLabMQuickJsPhysicalCapability {
  readonly renderV2Profile: "framer-f1-render-v2-mquickjs-v1";
  readonly screenId: 28;
  readonly physicalCanary: true;
  readonly hardwareRuntimeProven: false;
  readonly runtimeUploader: false;
  readonly baseAppSha256: string;
  readonly boot: string;
  readonly moduleSha256: string;
  readonly slotBytes: 196608;
  readonly packageSha256: string;
  readonly generation: number;
  readonly keyEvents: boolean;
  readonly chordEvents: boolean;
  readonly hostEvents: true;
  readonly timerSources: true;
  readonly deviceEvaluatesJavaScript: true;
  readonly deviceRunsJsdom: false;
  readonly screenIds: readonly [1, 7, 26, 27, 28];
}

export interface InputLabMQuickJsHostEventRequest {
  readonly id: number;
  readonly value: number;
  readonly auxiliary: number;
  readonly generation: number;
  readonly revision: number;
}

export interface InputLabMQuickJsDeviceReceipt {
  readonly state: "Q" | "A" | "R" | "B" | "H" | "F";
  readonly queueDepth: number;
  readonly sequence: number;
  readonly generation: number;
  readonly revision: number;
  readonly id: number;
  readonly value: number;
  readonly auxiliary: number;
  readonly appliedGeneration: number;
  readonly appliedRevision: number;
}

export const INPUT_LAB_MQUICKJS_BASE_APP_SHA256: string;
export const INPUT_LAB_MQUICKJS_CAPABILITY_PAGES: 13;
export const INPUT_LAB_MQUICKJS_TELEMETRY_PAGES: 6;
export const INPUT_LAB_MQUICKJS_TELEMETRY_ATTEMPTS: 3;
export const INPUT_LAB_MQUICKJS_STATUS_BYTES: 112;
export const INPUT_LAB_MQUICKJS_HOST_RPC_IDS: ReadonlyArray<number>;
export const INPUT_LAB_MQUICKJS_MODULE_ABI_SHA256: string;
export const INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET: Readonly<{
  postalCode: "60601";
  countryCode: "US";
  locationLabel: "CHICAGO";
  provider: "deterministic-offline-fixture";
}>;
export const INPUT_LAB_MQUICKJS_RPC_METHODS: Readonly<{
  capability: "widget.mquickjs.cap";
  telemetry: "widget.mquickjs.telemetry";
  event: "widget.mquickjs.event";
  receipt: "widget.mquickjs.receipt";
}>;
export const INPUT_LAB_MQUICKJS_REQUIRED_CAPABILITY: Readonly<Record<string, unknown>>;
export function parseInputLabMQuickJsCapabilityPages(
  statuses: ReadonlyArray<string>,
  expected?: Partial<Pick<InputLabMQuickJsPhysicalCapability,
    "baseAppSha256" | "boot" | "moduleSha256" | "packageSha256" | "generation">>,
): InputLabMQuickJsPhysicalCapability;
export function parseInputLabMQuickJsReceipt(
  response: string | Readonly<{ status: string }>,
): InputLabMQuickJsDeviceReceipt;
export function parseInputLabMQuickJsTelemetryPages(
  statuses: ReadonlyArray<string>,
): Readonly<Record<string, string | number | bigint | boolean>> & {
  readonly boot: string;
  readonly screenId: number;
  readonly visible: boolean;
  readonly appliedRevision: number;
  readonly weatherAppliedRevision: number;
  readonly uiMaximumUs: number;
};
export function deliverInputLabMQuickJsWeatherBatch(options: {
  sendHostEvents: (requests: ReadonlyArray<InputLabMQuickJsHostEventRequest>) => Promise<ReadonlyArray<Readonly<{
    status: "applied";
    receipt: InputLabMQuickJsDeviceReceipt;
  }>>>;
  events: ReadonlyArray<Readonly<{ id: number; value: number; auxiliary: number }>>;
  generation: number;
  revision: number;
  postalCode: string;
  countryCode: string;
}): Promise<Readonly<{
  status: "applied";
  revision: number;
  finalReceipt: InputLabMQuickJsDeviceReceipt;
  sequences: ReadonlyArray<number>;
}>>;
export function confirmInputLabMQuickJsWeatherRender(options: {
  probeTelemetry: () => Promise<ReturnType<typeof parseInputLabMQuickJsTelemetryPages>>;
  revision: number;
  wait?: (milliseconds: number) => Promise<void>;
  pollMs?: number;
  maximumPolls?: number;
}): Promise<Readonly<{
  status: "rendered" | "committed-hidden";
  revision: number;
  polls: number;
  telemetry: ReturnType<typeof parseInputLabMQuickJsTelemetryPages>;
}>>;
export class InputLabMQuickJsRpcClient {
  constructor(options: {
    call: (method: string, params: Readonly<Record<string, number>>) => Promise<Readonly<{ status: string }>>;
    wait?: (milliseconds: number) => Promise<void>;
    receiptPollMs?: number;
    maximumReceiptPolls?: number;
  });
  readonly capability: InputLabMQuickJsPhysicalCapability | null;
  probeCapability(options?: { force?: boolean; expected?: Partial<Pick<InputLabMQuickJsPhysicalCapability,
    "baseAppSha256" | "boot" | "moduleSha256" | "packageSha256" | "generation">> }):
    Promise<InputLabMQuickJsPhysicalCapability>;
  probeTelemetry(): Promise<ReturnType<typeof parseInputLabMQuickJsTelemetryPages>>;
  sendHostEvent(request: InputLabMQuickJsHostEventRequest,
    options?: { expectedTerminal?: "A" | "F"; allowFaultSentinel?: boolean }): Promise<Readonly<{
      status: "applied" | "fault-recovered";
      request: InputLabMQuickJsHostEventRequest;
      receipt: InputLabMQuickJsDeviceReceipt;
      polls: number;
    }>>;
  sendHostEvents(requests: ReadonlyArray<InputLabMQuickJsHostEventRequest>,
    options?: { expectedTerminal?: "A" | "F"; allowFaultSentinel?: boolean }): Promise<ReadonlyArray<Readonly<{
      status: "applied" | "fault-recovered";
      request: InputLabMQuickJsHostEventRequest;
      receipt: InputLabMQuickJsDeviceReceipt;
      polls: number;
    }>>>;
}

export class BrowserFramerSceneClient {
  constructor(options?: Readonly<Record<string, any>>);
  static connect(): Promise<BrowserFramerSceneClient>;
  close(): Promise<void>;
  probeRenderV2Capabilities(options?: { force?: boolean }): Promise<Readonly<Record<string, any>>>;
  queryRenderV2Capabilities(options?: { force?: boolean }): Promise<Readonly<Record<string, any>>>;
  probeMQuickJsCapabilities(options?: { force?: boolean; expected?: Partial<Pick<
    InputLabMQuickJsPhysicalCapability,
    "baseAppSha256" | "boot" | "moduleSha256" | "packageSha256" | "generation">> }):
    Promise<InputLabMQuickJsPhysicalCapability>;
  queryMQuickJsCapabilities(options?: { force?: boolean; expected?: Partial<Pick<
    InputLabMQuickJsPhysicalCapability,
    "baseAppSha256" | "boot" | "moduleSha256" | "packageSha256" | "generation">> }):
    Promise<InputLabMQuickJsPhysicalCapability>;
  probeMQuickJsTelemetry(): ReturnType<InputLabMQuickJsRpcClient["probeTelemetry"]>;
  runMQuickJsTransaction<T>(operation: (transaction: Readonly<{
    probeTelemetry: () => ReturnType<InputLabMQuickJsRpcClient["probeTelemetry"]>;
    sendHostEvent: InputLabMQuickJsRpcClient["sendHostEvent"];
    sendHostEvents: InputLabMQuickJsRpcClient["sendHostEvents"];
  }>) => Promise<T>): Promise<T>;
  pushBundle(bytes: Uint8Array, options?: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
  pushRenderV2Package(bytes: Uint8Array, options?: Readonly<Record<string, any>>): Promise<Readonly<Record<string, any>>>;
  sendRenderV2HostEvent(id: number, value: number): Promise<Readonly<Record<string, any>>>;
  sendMQuickJsHostEvent(request: InputLabMQuickJsHostEventRequest,
    options?: { expectedTerminal?: "A" | "F"; allowFaultSentinel?: boolean }):
    ReturnType<InputLabMQuickJsRpcClient["sendHostEvent"]>;
}

export const DEFAULT_INPUT_LAB_HTML: string;
export const DEFAULT_INPUT_LAB_CSS: string;
export const DEFAULT_INPUT_LAB_SLOTS: ReadonlyArray<Readonly<InputLabPreviewSlot>>;
export const DEFAULT_SLOT_NAMES: ReadonlyArray<string>;
export const GENERATING_PERIMETER_CSS: string;
export const GENERATING_PERIMETER_HTML: string;
export const GENERATING_PERIMETER_SETTINGS: Readonly<Required<InputLabRasterSettings>>;
export const REFERENCE_INPUT_LAB_CSS: string;

export type InputLabMQuickJsInputReason = 0 | 1 | 2 | 3;
export type InputLabMQuickJsEventName = "input.key.down" | "input.key.up" |
  "input.key.hold" | "input.chord.down" | "input.chord.up";

export interface InputLabMQuickJsKeyEntry {
  id?: number;
  browserCode?: string | null;
  code?: string | null;
  nativeToken?: number | null;
  label?: string | null;
}

export interface InputLabMQuickJsChordEntry {
  id?: number;
  heldMask: number;
}

export interface InputLabMQuickJsKeyConfig {
  keys?: ReadonlyArray<InputLabMQuickJsKeyEntry>;
  chords?: ReadonlyArray<InputLabMQuickJsChordEntry>;
  debounceMs?: number;
  holdDelayMs?: number;
  holdCadenceMs?: number;
}

export interface NormalizedInputLabMQuickJsKeyConfig {
  readonly keys: ReadonlyArray<Readonly<{
    id: number;
    browserCode: string | null;
    nativeToken: number | null;
    label: string | null;
  }>>;
  readonly chords: ReadonlyArray<Readonly<{ id: number; heldMask: number }>>;
  readonly debounceMs: number;
  readonly holdDelayMs: number;
  readonly holdCadenceMs: number;
  readonly deviceDeployable: boolean;
}

export interface InputLabMQuickJsEvent {
  readonly type: InputLabMQuickJsEventName;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly heldMask: number;
  readonly synthetic: boolean;
  readonly key?: number;
  readonly chord?: number;
  readonly repeat?: boolean;
  readonly holdCount?: number;
  readonly reason: InputLabMQuickJsInputReason;
}

export interface InputLabMQuickJsDrainResult {
  readonly status: "ok" | "more-pending";
  readonly morePending: boolean;
  readonly events: ReadonlyArray<InputLabMQuickJsEvent>;
  readonly heldMask: number;
}

export interface InputLabMQuickJsNativeObservation {
  readonly nativeToken: number;
  readonly pressed: boolean;
  readonly timestampMs: number;
  readonly observationSequence: number;
}

export const INPUT_LAB_MQUICKJS_INPUT_REASONS: Readonly<{
  physical: 0;
  focusLoss: 1;
  disconnect: 2;
  queueResync: 3;
}>;
export const INPUT_LAB_MQUICKJS_INPUT_LIMITS: Readonly<{
  keys: 16;
  chords: 8;
  chordKeys: 4;
  queueRecords: 32;
  drainRecords: 4;
  drainHolds: 2;
  pendingEvents: 64;
  callbacksPerIteration: 3;
  maxEventsPerDrain: 3;
  maxLogicalEventsPerBatch: 62;
  maxResyncEvents: 18;
  debounceMs: Readonly<{ minimum: 1; maximum: 50; default: 10 }>;
  holdDelayMs: Readonly<{ minimum: 100; maximum: 5000; default: 500 }>;
  holdCadenceMs: Readonly<{ minimum: 20; maximum: 1000; default: 100 }>;
}>;
export const INPUT_LAB_MQUICKJS_KEY_CAPABILITIES: Readonly<{
  profileId: "framer-f1-render-v2-mquickjs-v1";
  eventNames: ReadonlyArray<InputLabMQuickJsEventName>;
  hostSimulation: true;
  exactHeldSnapshots: true;
  physicalKeyHookProven: false;
  physicalKeyIdentityProven: false;
  nativeTokenLearningProven: false;
  hardwareRuntimeProven: false;
}>;

export function normalizeInputLabMQuickJsKeyConfig(
  value?: InputLabMQuickJsKeyConfig,
): NormalizedInputLabMQuickJsKeyConfig;
export function createInputLabMQuickJsPackageInput(
  value: InputLabMQuickJsKeyConfig | NormalizedInputLabMQuickJsKeyConfig,
): Readonly<{
  events: Readonly<{
    keys: ReadonlyArray<Readonly<{ id: number; nativeToken: number }>>;
    chords: ReadonlyArray<Readonly<{ id: number; heldMask: number }>>;
  }>;
  input: Readonly<{ debounceMs: number; holdDelayMs: number; holdCadenceMs: number }>;
}>;
export function mquickJsEventIsHeld(event: Pick<InputLabMQuickJsEvent, "heldMask">,
  keyId: number): boolean;
export function normalizeMQuickJsNativeObservation(
  value: InputLabMQuickJsNativeObservation | Readonly<Record<string, unknown>>,
): InputLabMQuickJsNativeObservation;
export function createMQuickJsLearnedKeyBinding(value: {
  id: number;
  observation: InputLabMQuickJsNativeObservation | Readonly<Record<string, unknown>>;
  label: string;
  browserCode?: string | null;
}): Readonly<{ id: number; nativeToken: number; label: string;
  browserCode: string | null; learnedFromObservationSequence: number }>;
export function assessInputLabMQuickJsKeyCapability(
  value?: Readonly<Record<string, unknown>>,
): Readonly<{ compatible: boolean; recordingCompatible: boolean;
  errors: ReadonlyArray<string> }>;

export class InputLabMQuickJsNativeKeyRecorder {
  constructor(options?: { capability?: Readonly<Record<string, unknown>> | null;
    hostCanary?: boolean });
  readonly assessment: ReturnType<typeof assessInputLabMQuickJsKeyCapability>;
  readonly hostCanary: boolean;
  readonly lastObservation: InputLabMQuickJsNativeObservation | null;
  poll(value: InputLabMQuickJsNativeObservation | Readonly<Record<string, unknown>>):
    InputLabMQuickJsNativeObservation | null;
  bind(value: { id: number; label: string; browserCode?: string | null }):
    ReturnType<typeof createMQuickJsLearnedKeyBinding>;
}

export class InputLabMQuickJsKeySimulator {
  constructor(value?: InputLabMQuickJsKeyConfig);
  readonly config: NormalizedInputLabMQuickJsKeyConfig;
  enqueueByCode(code: string, pressed: boolean, timestampMs: number):
    Readonly<{ status: "queued" | "duplicate" | "resync" | "unbound" | "disabled";
      accepted: boolean }>;
  enqueueKey(key: number, pressed: boolean, timestampMs: number):
    Readonly<{ status: "queued" | "duplicate" | "resync" | "disabled";
      accepted: boolean }>;
  drain(timestampMs: number): InputLabMQuickJsDrainResult;
  releaseAll(timestampMs: number, reason?: "focusLoss" | "disconnect" | 1 | 2,
    options?: { disableIngress?: boolean }): InputLabMQuickJsDrainResult;
  resumeIngress(): void;
  nextDueIn(timestampMs: number): number | null;
  snapshot(): Readonly<{ heldMask: number; authoritativeHeldMask: number;
    sequence: number; queueRecords: number; duplicateLevels: number;
    queueOverflows: number; resyncs: number; pendingEvents: number;
    ingressEnabled: boolean }>;
}

export class BrowserMQuickJsKeyBridge {
  constructor(options?: {
    simulator?: InputLabMQuickJsKeySimulator;
    config?: InputLabMQuickJsKeyConfig;
    eventTarget?: EventTarget;
    documentTarget?: EventTarget & { readonly hidden?: boolean };
    nowMs?: () => number;
    onEvents?: (events: ReadonlyArray<InputLabMQuickJsEvent>) => void;
    setTimer?: (callback: () => void, delay: number) => unknown;
    clearTimer?: (timer: unknown) => void;
  });
  readonly simulator: InputLabMQuickJsKeySimulator;
  start(): this;
  flush(timestampMs?: number): InputLabMQuickJsDrainResult;
  disconnect(): InputLabMQuickJsDrainResult;
}
