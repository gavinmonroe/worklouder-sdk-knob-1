export const STAGE3E2_SPECIES = Object.freeze([
  "Belgian Tervuren",
  "Pepe",
  "Angry owl",
  "Cute ferret",
  "Cat",
  "Lazy cow",
]);

export const STAGE3E2_STATES = Object.freeze([
  "ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping",
]);

export const STAGE3E2_DEFAULT_SPECIES = 4;
export const STAGE3E2_BOTTOM_ENCODER_ID = 1;

export function signExtendEncoderDelta(delta) {
  const byte = Number(delta) & 0xff;
  return byte >= 0x80 ? byte - 0x100 : byte;
}

export function cycleStage3e2Species(current, {
  encoderId,
  delta,
  inputAvailable = true,
  fnPressed = false,
} = {}) {
  if (!Number.isInteger(current) || current < 0 || current >= STAGE3E2_SPECIES.length) {
    throw new Error("Current species must be an index from 0 through 5.");
  }
  const signedDelta = signExtendEncoderDelta(delta);
  if (encoderId !== STAGE3E2_BOTTOM_ENCODER_ID || signedDelta === 0 ||
      !inputAvailable || !fnPressed) return current;
  return signedDelta > 0
    ? (current + 1) % STAGE3E2_SPECIES.length
    : (current + STAGE3E2_SPECIES.length - 1) % STAGE3E2_SPECIES.length;
}

export function stage3e2PetDescriptorIndex(species, state) {
  if (!Number.isInteger(species) || species < 0 || species >= STAGE3E2_SPECIES.length ||
      !Number.isInteger(state) || state < 0 || state >= STAGE3E2_STATES.length) {
    throw new Error("Descriptor species/state is outside the pinned roster.");
  }
  return 2 + species * STAGE3E2_STATES.length + state;
}

export function stage3e2PetDescriptorAddress(species, state, base = 0x3c1c1190) {
  return base + stage3e2PetDescriptorIndex(species, state) * 24;
}
