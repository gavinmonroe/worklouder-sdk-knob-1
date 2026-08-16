export const FRAMER_MEDIA_RUNTIME_BLOCKER = Object.freeze({
  code: "NO_PROVEN_FRAMER_MEDIA_RUNTIME_ADAPTER",
  status: "BLOCKED_BEFORE_DEVICE_IO",
  hardwareAccess: false,
  permittedHostTransport: "Input main-process debugger on 127.0.0.1:9230",
  inputVersion: "0.18.2",
  sdkVersion: "@worklouder/wl-device-kit 0.1.28",
  inputNomadMethods: Object.freeze(["mp.write_info", "mp.write_artwork", "mp.fetch_data"]),
  framerEvidence: Object.freeze([
    "Input enables mediaPlayer and mp.fetch_data only for NomadE/NomadEV2, not Knob/KnobF1.",
    "Input's screen-start service recognizes media-player only on NomadE/NomadEV2.",
    "Framer 0.4.1 and the current custom Music ID1 module have no proven mp.write_info handler.",
    "Framer 0.4.1 and the current custom Music ID1 module have no proven mp.write_artwork handler or bounded artwork receive buffer.",
    "Music ID1 currently renders a compiled mock track and exposes no host-fed state ABI.",
  ]),
  requiredAdapterProof: Object.freeze([
    "versioned bounded metadata message",
    "bounded artwork transaction with size/hash verification",
    "UI-thread application to controller-owned RAM",
    "timeout/stale/no-track behavior",
    "Framer-specific handler and rollback tests",
  ]),
});

/**
 * Deliberate terminal sink for today's Framer firmware. It makes the complete
 * host bundle observable without performing discovery, RPC, HID, serial, file
 * writes, or firmware access.
 */
export class BlockedFramerRuntimeSink {
  async publish({ bundle } = {}) {
    if (bundle?.manifest?.contract !== "host-fed-asset-transaction-v1") {
      throw new Error("Blocked Framer sink requires a host-fed-asset-transaction-v1 bundle.");
    }
    return Object.freeze({
      accepted: false,
      status: FRAMER_MEDIA_RUNTIME_BLOCKER.status,
      blocker: FRAMER_MEDIA_RUNTIME_BLOCKER,
      transactionId: bundle.manifest.transactionId,
    });
  }
}

export {
  BlockedMediaRuntimeSink,
  FramerMediaRuntimeSink,
  FRAMER_MEDIA_HANDLER_PROOF_FORMAT,
  FRAMER_MEDIA_PUBLISHING_BLOCKER,
  LIVE_PROVEN_FRAMER_MEDIA_HANDLERS,
  MockMediaRuntimeSink,
} from "../../../src/media-transport/sinks.mjs";
