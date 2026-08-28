// Pre-baked sample events the user can drop into the simulator queue.
// Each entry is a fully-typed event matching the simulator dispatch contract.

import type { SimulatedEvent } from "../types";
import { WEATHER_SCHEMA, encodeSnapshot } from "../data/schemas";

export interface SampleEvent {
  label: string;
  description: string;
  event: SimulatedEvent;
  /** Optional keys for key/chord events. */
  heldMaskValue?: number;
}

export const SAMPLE_EVENTS: SampleEvent[] = [
  {
    label: "tick.1ms",
    description: "Best-effort millisecond tick; event.value carries elapsed milliseconds.",
    event: { kind: "tick.1ms", value: 1, displayName: "tick.1ms" },
  },
  {
    label: "tick.1s",
    description: "Once-per-second device tick; the most common authoring event.",
    event: { kind: "tick.1s", displayName: "tick.1s" },
  },
  {
    label: "tick.100ms",
    description: "Ten-times-per-second device tick for high-cadence animation.",
    event: { kind: "tick.100ms", displayName: "tick.100ms" },
  },
  {
    label: "fn-bottom-knob +1",
    description: "User turned the bottom knob clockwise one detent while holding Fn.",
    event: { kind: "input.fn-bottom-knob", delta: 1, displayName: "fn+knob △1" },
  },
  {
    label: "fn-bottom-knob −3",
    description: "User turned the bottom knob counter-clockwise three detents while holding Fn.",
    event: { kind: "input.fn-bottom-knob", delta: -3, displayName: "fn+knob ▽3" },
  },
  {
    label: "host.rpc:0xB201 = 7",
    description: "Generic host RPC packet, id 0xB201, value 7 (palette index).",
    event: { kind: "host.rpc", id: 0xB201, value: 7, displayName: "0xB201 ← 7" },
  },
  {
    label: "host.rpc:0xC001 (weather temp)",
    description: "Weather snapshot host RPC. value = packed temperature, auxiliary = condition index.",
    event: { kind: "host.rpc", id: 0xC001, value: 72, displayName: "0xC001 (weather)" },
  },
  {
    label: "host.rpc:0xB240 (begin revision)",
    description: "Weather canary begin: announce the next revision before staging forecast records.",
    event: { kind: "host.rpc", id: 0xB240, value: 18, displayName: "0xB240 begin" },
  },
];

/**
 * A complete weather snapshot, generated from WEATHER_SCHEMA rather than
 * hand-computed. Change a field width or order in src/data/schemas.ts and these
 * payloads follow automatically — there is no second copy of the layout to keep
 * in sync, and no literal packed integers to get wrong.
 */
const WEATHER_SNAPSHOT_VALUES = {
  current: { temperature: 72, condition: 0, isDay: 1 },
  day1: { low: 58, high: 74, condition: 0, weekday: 1 },
  day2: { low: 60, high: 77, condition: 1, weekday: 2 },
  day3: { low: 55, high: 70, condition: 5, weekday: 3 },
};

const WEATHER_SNAPSHOT_LABELS: Record<number, { label: string; description: string }> = {
  [WEATHER_SCHEMA.begin]: {
    label: "begin rev 42",
    description: "Announce revision 42. Nothing renders until a matching commit arrives.",
  },
  [WEATHER_SCHEMA.records.current.id]: {
    label: "current 72° clear",
    description: "Current conditions: 72°, clear, daytime.",
  },
  [WEATHER_SCHEMA.records.day1.id]: {
    label: "Mon 58/74 clear",
    description: "Forecast day 1.",
  },
  [WEATHER_SCHEMA.records.day2.id]: {
    label: "Tue 60/77 partly",
    description: "Forecast day 2.",
  },
  [WEATHER_SCHEMA.records.day3.id]: {
    label: "Wed 55/70 rain",
    description: "Forecast day 3.",
  },
  [WEATHER_SCHEMA.commit]: {
    label: "commit rev 42",
    description: "Matches the begin, so the staged snapshot goes live. A mismatch is dropped.",
  },
};

export const WEATHER_SNAPSHOT_EVENTS: SampleEvent[] = encodeSnapshot(
  WEATHER_SCHEMA,
  42,
  WEATHER_SNAPSHOT_VALUES,
).map(({ id, value }) => {
  const meta = WEATHER_SNAPSHOT_LABELS[id];
  return {
    label: `0x${id.toString(16).toUpperCase()} ${meta.label}`,
    description: meta.description,
    event: { kind: "host.rpc", id, value, displayName: `0x${id.toString(16).toUpperCase()} ${meta.label}` },
  };
});

export const KEY_EVENTS: SampleEvent[] = [
  {
    label: "input.key.down id=0",
    description: "Down edge for the first declared physical key (bit 0 of heldMask).",
    event: { kind: "input.key.down", id: 0, displayName: "key ↓ id 0" },
  },
  {
    label: "input.key.up id=0",
    description: "Up edge for the first declared physical key.",
    event: { kind: "input.key.up", id: 0, displayName: "key ↑ id 0" },
  },
  {
    label: "input.key.hold id=0",
    description: "Auto-repeat while a key stays held; fires on the hold cadence, not the down edge.",
    event: { kind: "input.key.hold", id: 0, displayName: "key ⇩ hold id 0" },
  },
  {
    label: "input.chord.up mask=0b0011",
    description: "Release edge for a chord. Pairs with chord.down; widgets often act on one or the other, not both.",
    event: { kind: "input.chord.up", mask: 0b0011, displayName: "chord ↑ 0b0011" },
  },
  {
    label: "input.chord.down mask=0b0011",
    description: "Two keys held simultaneously; ordering doesn't matter, the mask is exact.",
    event: { kind: "input.chord.down", mask: 0b0011, displayName: "chord ↓ 0b0011" },
    heldMaskValue: 0b0011,
  },
];

export const SAMPLE_LOOP: SampleEvent["event"][] = [
  { kind: "tick.1s", displayName: "tick.1s × 30" },
  { kind: "tick.1s", displayName: "tick.1s × 29" },
  { kind: "tick.1s", displayName: "tick.1s × 28" },
  { kind: "tick.1s", displayName: "tick.1s × 27" },
  { kind: "tick.1s", displayName: "tick.1s × 26" },
  { kind: "input.fn-bottom-knob", delta: 1, displayName: "knob △1" },
  { kind: "host.rpc", id: 0xB201, value: 3, displayName: "0xB201 ← 3" },
];
