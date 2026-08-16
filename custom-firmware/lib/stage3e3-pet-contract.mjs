import {
  STAGE3E2_BOTTOM_ENCODER_ID,
  STAGE3E2_DEFAULT_SPECIES,
  STAGE3E2_SPECIES,
  STAGE3E2_STATES,
  cycleStage3e2Species,
} from "./stage3e2-species-control.mjs";

export const STAGE3E3_SPECIES = STAGE3E2_SPECIES;
export const STAGE3E3_STATES = STAGE3E2_STATES;
export const STAGE3E3_DEFAULT_SPECIES = STAGE3E2_DEFAULT_SPECIES;
export const STAGE3E3_BOTTOM_ENCODER_ID = STAGE3E2_BOTTOM_ENCODER_ID;
export const STAGE3E3_ASSET_BASE = 0x3c1c1190;
export const STAGE3E3_DESCRIPTOR_BYTES = 24;
export const STAGE3E3_SOURCE_SIZE = Object.freeze({ width: 52, height: 42 });
export const STAGE3E3_SCALE = 0x200;
export const STAGE3E3_VISIBLE_SIZE = Object.freeze({ width: 104, height: 84 });

export const cycleStage3e3Species = cycleStage3e2Species;

export function stage3e3PetDescriptorIndex(species, state) {
  if (!Number.isInteger(species) || species < 0 || species >= STAGE3E3_SPECIES.length ||
      !Number.isInteger(state) || state < 0 || state >= STAGE3E3_STATES.length) {
    throw new Error("Stage-3E.3 descriptor species/state is outside the pinned roster.");
  }
  return species * STAGE3E3_STATES.length + state;
}

export function stage3e3PetDescriptorAddress(species, state) {
  return STAGE3E3_ASSET_BASE + stage3e3PetDescriptorIndex(species, state) * STAGE3E3_DESCRIPTOR_BYTES;
}
