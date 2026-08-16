function invariant(value, message) {
  if (!value) throw new Error(message);
}

export class MockSceneTransport {
  constructor() {
    this.calls = [];
    this.activeSlot = null;
  }

  async applyScene({ scene, binary, slot }) {
    invariant(scene?.viewport?.width === 100 && scene?.viewport?.height === 310,
      "Scene transport requires an exact 100x310 scene.");
    invariant(Buffer.isBuffer(binary) && binary.length > 0, "Scene transport requires compiled bytes.");
    invariant(Number.isInteger(slot) && slot >= 0 && slot < 3, "Scene slot must be 0, 1, or 2.");
    this.activeSlot = slot;
    this.calls.push(Object.freeze({ slot, sha256: scene.sha256, bytes: binary.length }));
    return Object.freeze({ status: "mock-applied", mode: "mock", activeSlot: slot,
      sha256: scene.sha256, bytes: binary.length, hardwareAccess: false });
  }

  async applySceneBundle({ bundle }) {
    invariant(bundle?.format === "framer-widget-bundle-v1" && Buffer.isBuffer(bundle.binary),
      "Scene transport requires an F1WB bundle.");
    this.activeSlot = bundle.activeSlot;
    this.calls.push(Object.freeze({ activeSlot: bundle.activeSlot, sha256: bundle.sha256,
      bytes: bundle.binary.length, slots: bundle.slots.length }));
    return Object.freeze({ status: "mock-bundle-applied", mode: "mock", activeSlot: bundle.activeSlot,
      sha256: bundle.sha256, bytes: bundle.binary.length, slots: bundle.slots.length, hardwareAccess: false });
  }
}

export class FailClosedLiveSceneTransport {
  async applyScene() {
    const error = new Error("Input Lab live scene transport is not explicitly injected.");
    error.code = "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT";
    throw error;
  }


  async applySceneBundle() { return this.applyScene(); }
}

export function requireSceneTransport(transport) {
  invariant(transport && typeof transport.applySceneBundle === "function",
    "An injectable scene transport with applySceneBundle() is required.");
  return transport;
}
