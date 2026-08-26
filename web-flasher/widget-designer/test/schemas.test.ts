// The whole point of the schema is that offsets are derived, never written.
// That only holds if the derivation reproduces the SDK's real wire layout, so
// these compare against f1-widget-sdk/src/render-v2/weather.mjs — the code that
// actually talks to firmware. If someone reorders a field, this fails instead
// of the device rendering nonsense.

import { describe, expect, it } from "vitest";

import {
  WEATHER_SCHEMA,
  encodeSnapshot,
  fieldOffsets,
  packRecord,
  unpackRecord,
} from "../src/data/schemas";

// Re-implements the SDK's packing literally, offsets and all, as an
// independent oracle. Kept verbose on purpose: it must not share code with the
// thing it is checking.
const sdkPackCurrent = (temperature: number, condition: number, isDay: boolean) =>
  ((temperature & 0x3ff) | (condition << 10) | ((isDay ? 1 : 0) << 14)) | 0;
const sdkPackDay = (low: number, high: number, condition: number, weekdayId: number) =>
  ((low & 0x3ff) | ((high & 0x3ff) << 10) | (condition << 20) | (weekdayId << 24)) | 0;

describe("host-data schemas", () => {
  it("derives the SDK's exact field offsets from declaration order", () => {
    expect(fieldOffsets(WEATHER_SCHEMA.records.current)).toEqual({
      temperature: 0, condition: 10, isDay: 14,
    });
    expect(fieldOffsets(WEATHER_SCHEMA.records.day1)).toEqual({
      low: 0, high: 10, condition: 20, weekday: 24,
    });
  });

  it("packs current conditions identically to the SDK", () => {
    const mine = packRecord(WEATHER_SCHEMA.records.current, { temperature: 72, condition: 0, isDay: 1 });
    expect(mine).toBe(sdkPackCurrent(72, 0, true));
    expect(mine).toBe(16456); // the value the device was verified against
  });

  it("packs forecast days identically to the SDK", () => {
    const cases: [number, number, number, number][] = [
      [58, 74, 0, 1], [60, 77, 1, 2], [55, 70, 5, 3], [-12, 4, 6, 0],
    ];
    for (const [low, high, condition, weekday] of cases) {
      expect(packRecord(WEATHER_SCHEMA.records.day1, { low, high, condition, weekday }))
        .toBe(sdkPackDay(low, high, condition, weekday));
    }
  });

  it("round-trips signed fields through negative temperatures", () => {
    for (const temperature of [-40, -1, 0, 1, 72, 511]) {
      const packed = packRecord(WEATHER_SCHEMA.records.current, { temperature, condition: 2, isDay: 0 });
      expect(unpackRecord(WEATHER_SCHEMA.records.current, packed).temperature).toBe(temperature);
    }
  });

  it("refuses values that do not fit their declared width", () => {
    expect(() => packRecord(WEATHER_SCHEMA.records.current, { temperature: 512, condition: 0, isDay: 1 }))
      .toThrow(/signed bits/);
    expect(() => packRecord(WEATHER_SCHEMA.records.current, { temperature: 0, condition: 16, isDay: 1 }))
      .toThrow(/unsigned bits/);
  });

  it("rejects a record that overflows the 32-bit payload", () => {
    expect(() => fieldOffsets({ id: 1, fields: { a: { bits: 20 }, b: { bits: 20 } } }))
      .toThrow(/the payload is 32/);
  });

  it("encodes a snapshot as begin, records in order, then commit", () => {
    const events = encodeSnapshot(WEATHER_SCHEMA, 42, {
      current: { temperature: 72, condition: 0, isDay: 1 },
      day1: { low: 58, high: 74, condition: 0, weekday: 1 },
      day2: { low: 60, high: 77, condition: 1, weekday: 2 },
      day3: { low: 55, high: 70, condition: 5, weekday: 3 },
    });
    expect(events.map((e) => e.id)).toEqual([0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb24f]);
    expect(events[0].value).toBe(42);
    expect(events.at(-1)!.value).toBe(42);
    // Exactly the payloads that were verified on hardware.
    expect(events.slice(1, 5).map((e) => e.value)).toEqual([16456, 16853050, 34681916, 55646263]);
  });
});
