/// <reference types="node" />

export type RgbaArtwork = Readonly<{
  format: "rgba8";
  width: number;
  height: number;
  pixels: Uint8Array;
}>;

export type HostMediaSnapshot = Readonly<{
  title: string;
  artist: string;
  durationMs: number;
  positionMs: number;
  isPlaying?: boolean;
  albumArt: RgbaArtwork;
  provenance?: Readonly<Record<string, unknown>>;
}>;

export interface MediaSource {
  getCurrentMedia(): Promise<HostMediaSnapshot | null>;
}

export type InputMediaProbeStatus = Readonly<{
  status: "active-media" | "no-active-media";
  reason:
    | "provider-returned-media"
    | "provider-timeout"
    | "provider-inactive"
    | "empty-provider-output"
    | "youtube-transition-duration-mismatch";
  timeoutMs: number | null;
}>;

export type MediaHostHello = Readonly<{
  protocol: "framer-host-media-v1";
  type: "host-hello";
  hostRole: "media-source";
  screenId: 1;
  chunkRawBytes: 3072;
  artworkFormats: readonly ["rgb565-le"];
  publishingPolicy: "require-live-proven-framer-handler";
}>;

export type BlockedMediaCapabilities = Readonly<{
  protocol: "framer-host-media-v1";
  type: "device-capabilities";
  deviceFamily: "knob_f1";
  status: "blocked";
  runtimeProof: string;
  reason: string;
  hardwareAccess: boolean;
}>;

export type ReadyMediaCapabilities = Readonly<{
  protocol: "framer-host-media-v1";
  type: "device-capabilities";
  deviceFamily: "knob_f1";
  status: "ready";
  runtimeProof: "live-proven" | "mock";
  metadata: true;
  artwork: true;
  atomicArtworkCommit: true;
  uiThreadApply: true;
  maxTextBytes: number;
  maxArtworkWidth: number;
  maxArtworkHeight: number;
  maxArtworkBytes: number;
  chunkRawBytes: 3072;
  artworkFormats: readonly ["rgb565-le"];
  hardwareAccess: boolean;
}>;

export type MediaCapabilities = BlockedMediaCapabilities | ReadyMediaCapabilities;

export type MediaMetadataPayload = Readonly<Partial<{
  song_title: string;
  artist: string;
  elapsed: number;
  total_duration: number;
  is_playing: boolean;
  accent_color: string;
}>>;

export type MediaMetadataMessage = Readonly<{
  protocol: "framer-host-media-v1";
  type: "media-metadata";
  generation: number;
  screenId: 1;
  payload: MediaMetadataPayload;
  fullPayloadSha256?: string;
  sha256: string;
}>;

export type ArtworkManifest = Readonly<{
  protocol: "framer-host-media-v1";
  type: "artwork-begin";
  generation: number;
  screenId: 1;
  format: "rgb565-le";
  width: number;
  height: number;
  totalBytes: number;
  sha256: string;
  chunkRawBytes: 3072;
  transactionId: string;
  totalChunks: number;
}>;

export type ArtworkChunk = Readonly<{
  protocol: "framer-host-media-v1";
  type: "artwork-chunk";
  generation: number;
  transactionId: string;
  index: number;
  offset: number;
  size: number;
  bytes: number;
  data: string;
  sha256: string;
}>;

export type ArtworkCommit = Readonly<{
  protocol: "framer-host-media-v1";
  type: "artwork-commit";
  generation: number;
  transactionId: string;
  totalBytes: number;
  totalChunks: number;
  sha256: string;
}>;

export type ArtworkTransaction = Readonly<{
  manifest: ArtworkManifest;
  chunks: readonly ArtworkChunk[];
  commit: ArtworkCommit;
  pixels: Buffer;
}>;

export type SinkAcceptance = Readonly<{
  accepted: boolean;
  reason?: string;
  [key: string]: unknown;
}>;

export interface MediaRuntimeSink {
  handshake(hello: MediaHostHello): Promise<MediaCapabilities>;
  publishMetadata(message: MediaMetadataMessage): Promise<SinkAcceptance>;
  beginArtwork(manifest: ArtworkManifest): Promise<SinkAcceptance>;
  writeArtworkChunk(chunk: ArtworkChunk): Promise<SinkAcceptance>;
  commitArtwork(commit: ArtworkCommit): Promise<SinkAcceptance>;
  abortArtwork?(manifest: ArtworkManifest): Promise<void>;
}

export type MediaPollResult = Readonly<{
  status: "blocked" | "no-active-media" | "retained-transient-inactive" | "unchanged" | "published" | "published-stopped";
  generation?: number | null;
  metadata?: boolean;
  artwork?: boolean;
  transactionId?: string | null;
  reason?: string;
  inactiveForMs?: number;
  graceMs?: number;
  hardwareAccess?: boolean;
}>;

export const MEDIA_TRANSPORT_PROTOCOL: "framer-host-media-v1";
export const MEDIA_TRANSPORT_SCREEN_ID: 1;
export const MEDIA_CHUNK_RAW_BYTES: 3072;
export const MEDIA_CHUNK_BASE64_CHARS: 4096;
export const MEDIA_DEFAULT_TEXT_BYTES: 256;
export const MEDIA_MAX_ARTWORK_BYTES: number;
export const FRAMER_MEDIA_HANDLER_PROOF_FORMAT: "framer-media-handler-live-proof-v1";
export const LIVE_PROVEN_FRAMER_MEDIA_HANDLERS: readonly Readonly<{
  id: string;
  format: "framer-media-handler-live-proof-v1";
  target: Readonly<{ deviceFamily: "knob_f1"; firmware: "0.4.1"; screenId: 1 }>;
  app: Readonly<{ bytes: number; sha256: string }>;
  code: Readonly<{ bytes: number; sha256: string }>;
  handlers: Readonly<{ metadata: "mp.write_info"; artwork: "mp.write_artwork" }>;
  receipt: Readonly<Record<string, unknown>>;
  liveValidation: Readonly<Record<string, unknown>>;
}>[];
export function isAcceptedFramerMediaResponse(response: unknown): boolean;
export const FRAMER_MEDIA_PUBLISHING_BLOCKER: Readonly<{
  code: "NO_LIVE_PROVEN_FRAMER_MEDIA_HANDLER";
  status: "blocked";
  reason: string;
  hardwareAccess: false;
  nomadMethodsNotAssumedCompatible: readonly string[];
}>;

export function stableMediaJson(value: unknown): string;
export function mediaSha256(value: unknown): string;
export function fitUtf8Text(value: string, maxBytes?: number, fallback?: string): string;
export function normalizeTransportSnapshot(raw: HostMediaSnapshot,
  options?: { maxTextBytes?: number }): HostMediaSnapshot;
export function createMediaHostHello(): MediaHostHello;
export function validateMediaHostHello(raw: unknown): MediaHostHello;
export function normalizeMediaCapabilities(raw: unknown): MediaCapabilities;
export function negotiateMediaCapabilities(hello: MediaHostHello, raw: unknown): MediaCapabilities;
export function createMediaMetadataPayload(snapshot: HostMediaSnapshot,
  capabilities: ReadyMediaCapabilities): Required<MediaMetadataPayload>;
export function createMetadataMessage(snapshot: HostMediaSnapshot,
  capabilities: ReadyMediaCapabilities, generation: number,
  previousSnapshot?: HostMediaSnapshot | null): MediaMetadataMessage;
export function createStoppedMetadataMessage(capabilities: ReadyMediaCapabilities,
  generation: number): MediaMetadataMessage;
export function resizeRgbaNearest(albumArt: RgbaArtwork, width: number, height: number): RgbaArtwork;
export function encodeRgb565Le(albumArt: RgbaArtwork): Buffer;
export function createArtworkTransaction(snapshot: HostMediaSnapshot,
  capabilities: ReadyMediaCapabilities, generation: number): ArtworkTransaction;

export type InputLocalhostMediaSourceOptions = Readonly<{
  evaluate?: (expression: string, options: { port: number; timeoutMs: number }) => Promise<unknown>;
  port?: number;
  scriptPath?: string;
  expectedScriptSha256?: string;
  providerTimeoutMs?: number;
  debuggerTimeoutMs?: number;
  maxOutputBytes?: number;
  maxArtworkBytes?: number;
  artworkTimeoutMs?: number;
  artworkSide?: number;
  clock?: () => number;
  fetchImpl?: typeof fetch;
  decodeArtwork?: (bytes: Uint8Array, options: { side: number }) => Promise<RgbaArtwork>;
  findActiveAppleTrack?: typeof findActiveAppleMusicTrack;
  findActiveYouTubeTab?: typeof findActiveYouTubeMusicTab;
  findYouTubeVideo?: typeof findLatestYouTubeMusicVideo;
  findYouTubeMetadata?: typeof findYouTubeMusicOEmbed;
  youtubeHistoryMaxAgeMs?: number;
  findAppleArtwork?: typeof findAppleCatalogArtwork;
}>;

export type ActiveAppleMusicTrack = Readonly<{
  title: string;
  artist: string;
  durationMs: number;
  positionMs: number;
  isPlaying: true;
}>;

export function findActiveAppleMusicTrack(options?: {
  exec?: (...args: unknown[]) => Promise<{ stdout: string }>;
}): Promise<ActiveAppleMusicTrack | null>;

export type YouTubeMusicTab = Readonly<{
  url: string;
  title: string;
  windowIndex: number | null;
  tabIndex: number | null;
  videoId: string;
}>;

export function findActiveYouTubeMusicTab(options?: {
  exec?: (...args: unknown[]) => Promise<{ stdout: string }>;
}): Promise<YouTubeMusicTab | null>;

export type YouTubeMusicVideo = Readonly<{
  videoId: string;
  url: string;
  profileTitle: string;
  visitedAtMs: number | null;
}>;

export function findLatestYouTubeMusicVideo(options?: {
  title?: string;
  chromeRoot?: string;
  exec?: (...args: unknown[]) => Promise<{ stdout: string }>;
  readDirectory?: (...args: unknown[]) => Promise<unknown[]>;
  nowMs?: number;
  maxAgeMs?: number | null;
}): Promise<YouTubeMusicVideo | null>;

export type YouTubeMusicOEmbed = Readonly<{
  title: string;
  artist: string;
  thumbnailUrl: string;
  videoId: string;
  durationMs: number | null;
}>;

export function findYouTubeMusicOEmbed(options: {
  videoId: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  maxWatchPageBytes?: number;
  timeoutMs?: number;
}): Promise<YouTubeMusicOEmbed | null>;

export type AppleCatalogArtwork = Readonly<{
  albumArt: RgbaArtwork;
  artworkUrl: string;
  trackName: string;
  artistName: string;
  collectionName: string | null;
}>;

export function findAppleCatalogArtwork(options: {
  title: string;
  artist: string;
  fetchImpl?: typeof fetch;
  decodeArtwork?: (bytes: Uint8Array, options: { side: number }) => Promise<RgbaArtwork>;
  side?: number;
  maxArtworkBytes?: number;
  maxCatalogBytes?: number;
  timeoutMs?: number;
}): Promise<AppleCatalogArtwork | null>;

export class InputLocalhostMediaSource implements MediaSource {
  constructor(options?: InputLocalhostMediaSourceOptions);
  readonly lastProbeStatus: InputMediaProbeStatus | null;
  getCurrentMedia(): Promise<HostMediaSnapshot | null>;
}
export { InputLocalhostMediaSource as InputLocalhostMediaAdapter };

export class MediaTransportSession {
  constructor(options: {
    source: MediaSource;
    sink: MediaRuntimeSink;
    pollIntervalMs?: number;
    inactiveGraceMs?: number;
    clock?: () => number;
    allowMockRuntime?: boolean;
    initialGeneration?: number;
  });
  readonly pollIntervalMs: number;
  readonly nextGeneration: number;
  handshake(): Promise<MediaCapabilities>;
  pollOnce(): Promise<MediaPollResult>;
  start(callbacks?: {
    onResult?: (result: MediaPollResult) => void;
    onError?: (error: unknown) => void;
  }): () => void;
  stop(): void;
}

export class BlockedMediaRuntimeSink implements MediaRuntimeSink {
  constructor(blocker?: typeof FRAMER_MEDIA_PUBLISHING_BLOCKER);
  handshake(hello: MediaHostHello): Promise<BlockedMediaCapabilities>;
  publishMetadata(message: MediaMetadataMessage): Promise<SinkAcceptance>;
  beginArtwork(manifest: ArtworkManifest): Promise<SinkAcceptance>;
  writeArtworkChunk(chunk: ArtworkChunk): Promise<SinkAcceptance>;
  commitArtwork(commit: ArtworkCommit): Promise<SinkAcceptance>;
}

export class MockMediaRuntimeSink implements MediaRuntimeSink {
  constructor(options?: { capabilities?: Partial<ReadyMediaCapabilities>; reject?: string | null });
  readonly capabilities: ReadyMediaCapabilities;
  readonly handshakes: readonly MediaHostHello[];
  readonly metadata: readonly MediaMetadataMessage[];
  readonly committedArtwork: readonly Readonly<{
    manifest: ArtworkManifest;
    commit: ArtworkCommit;
    pixels: Buffer;
  }>[];
  handshake(hello: MediaHostHello): Promise<ReadyMediaCapabilities>;
  publishMetadata(message: MediaMetadataMessage): Promise<SinkAcceptance>;
  beginArtwork(manifest: ArtworkManifest): Promise<SinkAcceptance>;
  writeArtworkChunk(chunk: ArtworkChunk): Promise<SinkAcceptance>;
  commitArtwork(commit: ArtworkCommit): Promise<SinkAcceptance>;
  abortArtwork(manifest?: ArtworkManifest): Promise<void>;
}

export type FramerMediaRuntimeTransport = Readonly<{
  negotiate(hello: MediaHostHello): Promise<MediaCapabilities>;
  rpc(method: "mp.write_info" | "mp.write_artwork", params: unknown): Promise<{
    accepted?: boolean;
    status?: string;
  }>;
}>;

export class FramerMediaRuntimeSink implements MediaRuntimeSink {
  constructor(options: { proofId?: string; transport: FramerMediaRuntimeTransport });
  handshake(hello: MediaHostHello): Promise<MediaCapabilities>;
  publishMetadata(message: MediaMetadataMessage): Promise<SinkAcceptance>;
  beginArtwork(manifest: ArtworkManifest): Promise<SinkAcceptance>;
  writeArtworkChunk(chunk: ArtworkChunk): Promise<SinkAcceptance>;
  commitArtwork(commit: ArtworkCommit): Promise<SinkAcceptance>;
  abortArtwork(manifest?: ArtworkManifest): Promise<void>;
}

export function buildInputWlrpcExpression(method: "mp.write_info" | "mp.write_artwork",
  params: Readonly<Record<string, unknown>>): string;

export class InputWlrpcMediaTransport implements FramerMediaRuntimeTransport {
  constructor(options?: {
    evaluate?: (expression: string, options: { port: number; timeoutMs: number }) => Promise<unknown>;
    port?: number;
    timeoutMs?: number;
  });
  negotiate(hello: MediaHostHello): Promise<ReadyMediaCapabilities>;
  rpc(method: "mp.write_info" | "mp.write_artwork",
    params: Readonly<Record<string, unknown>>): Promise<{ accepted?: boolean; status?: string }>;
}

export const DEFAULT_INPUT_DEBUG_PORT: number;
export const DEFAULT_INPUT_MEDIA_SCRIPT: string;
export const INPUT_MEDIA_SCRIPT_SHA256: string;
export const INPUT_MEDIA_PROBE_STATUS: Readonly<{
  active: "active-media";
  inactive: "no-active-media";
}>;
export function buildInputMediaProbeExpression(options?: Readonly<Record<string, unknown>>): string;
export function parseInputMediaRecord(output: string): Map<string, string>;
export function decodeArtworkRgba(bytes: Uint8Array, options?: { side?: number }): Promise<RgbaArtwork>;
export function makeFallbackAlbumArt(title: string, artist: string,
  options?: { side?: number }): RgbaArtwork;
