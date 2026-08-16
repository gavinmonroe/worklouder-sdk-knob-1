export const ROSTER_STATE_ORDER = Object.freeze([
  "ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping",
]);

export const CONTROLLER_LOCAL_INPUT = Object.freeze({
  scope: "controller-local",
  screenId: 7,
  vtableSlot: 9,
  chord: "fn+bottom-encoder",
  encoder: Object.freeze({
    id: 1,
    clockwise: "next",
    counterclockwise: "previous",
    deltaEncoding: "zero-extended-signed-i8",
    wrap: true,
  }),
  selectionStorage: "controller-ram-only",
  resetOn: "reboot",
  globalKeyHook: false,
  hardwareAccess: false,
});

export function signExtendEncoderDelta(delta) {
  const byte = Number(delta) & 0xff;
  return byte >= 0x80 ? byte - 0x100 : byte;
}

export function cycleRosterSpecies(current, speciesCount, {
  encoderId,
  delta,
  inputAvailable = true,
  fnPressed = false,
} = {}) {
  if (!Number.isInteger(speciesCount) || speciesCount < 1 || speciesCount > 15) {
    throw new Error("Species count must be an integer from 1 through 15.");
  }
  if (!Number.isInteger(current) || current < 0 || current >= speciesCount) {
    throw new Error("Current species is outside the roster.");
  }
  const signedDelta = signExtendEncoderDelta(delta);
  if (encoderId !== CONTROLLER_LOCAL_INPUT.encoder.id || signedDelta === 0 ||
      !inputAvailable || !fnPressed) return current;
  return signedDelta > 0
    ? (current + 1) % speciesCount
    : (current + speciesCount - 1) % speciesCount;
}

export function petDescriptorIndex(species, state, speciesCount) {
  if (!Number.isInteger(speciesCount) || speciesCount < 1 || speciesCount > 15 ||
      !Number.isInteger(species) || species < 0 || species >= speciesCount ||
      !Number.isInteger(state) || state < 0 || state >= ROSTER_STATE_ORDER.length) {
    throw new Error("Descriptor species/state is outside the declarative roster.");
  }
  return 2 + species * ROSTER_STATE_ORDER.length + state;
}

export function petDescriptorAddress(species, state, speciesCount, baseAddress = 0x3c1c1190) {
  return baseAddress + petDescriptorIndex(species, state, speciesCount) * 24;
}
