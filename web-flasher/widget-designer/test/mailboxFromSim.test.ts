import { describe, expect, it } from "vitest";

import { mailboxFromDeviceSlots, freshRenderState } from "../src/compiler/mailboxFromSim";

const slots = (overrides: Record<number, number> = {}): number[] => {
  const s = Array(16).fill(0);
  for (const [k, v] of Object.entries(overrides)) s[Number(k)] = v;
  return s;
};

describe("mailboxFromDeviceSlots", () => {
  it("frames 16 committed slots as a non-torn mailbox at the given generation", () => {
    const mailbox = mailboxFromDeviceSlots(slots({ 0: 3, 3: 429 }), 9);
    expect(mailbox.slots).toHaveLength(16);
    expect(mailbox.slots[0]).toBe(3);
    expect(mailbox.slots[3]).toBe(429);
    expect(mailbox.admittedGeneration).toBe(9);
  });

  it("produces an even sequence with sequenceAfter === sequence (never torn)", () => {
    for (const rev of [0, 1, 2, 7, 128]) {
      const mailbox = mailboxFromDeviceSlots(slots({ 0: rev }), 1);
      expect(mailbox.sequence & 1).toBe(0);
      expect(mailbox.sequenceAfter).toBe(mailbox.sequence);
    }
  });

  it("makes the sequence strictly increase with the publication revision", () => {
    const a = mailboxFromDeviceSlots(slots({ 0: 1 }), 1);
    const b = mailboxFromDeviceSlots(slots({ 0: 2 }), 1);
    const c = mailboxFromDeviceSlots(slots({ 0: 10 }), 1);
    expect(b.sequence).toBeGreaterThan(a.sequence);
    expect(c.sequence).toBeGreaterThan(b.sequence);
  });

  it("defensively copies the slots so later mutation does not leak in", () => {
    const source = slots({ 0: 1, 5: 42 });
    const mailbox = mailboxFromDeviceSlots(source, 1);
    source[5] = 999;
    source[0] = 777;
    expect(mailbox.slots[5]).toBe(42);
    expect(mailbox.slots[0]).toBe(1);
  });

  it("rejects a slot array that is not exactly 16 integers", () => {
    expect(() => mailboxFromDeviceSlots([], 1)).toThrow(TypeError);
    expect(() => mailboxFromDeviceSlots(Array(15).fill(0), 1)).toThrow(TypeError);
    expect(() => mailboxFromDeviceSlots(Array(17).fill(0), 1)).toThrow(TypeError);
    expect(() => mailboxFromDeviceSlots(slots({ 2: 1.5 }), 1)).toThrow(TypeError);
    // Non-array inputs are refused too.
    expect(() => mailboxFromDeviceSlots(null as unknown as number[], 1)).toThrow(TypeError);
  });

  it("rejects a generation below 1 or non-integer", () => {
    expect(() => mailboxFromDeviceSlots(slots(), 0)).toThrow(TypeError);
    expect(() => mailboxFromDeviceSlots(slots(), -3)).toThrow(TypeError);
    expect(() => mailboxFromDeviceSlots(slots(), 1.5)).toThrow(TypeError);
  });

  it("treats slot 0 as an unsigned revision when deriving the sequence", () => {
    // A negative slot-0 would be a bug upstream, but the >>> 0 keeps the
    // derived sequence a valid (even, finite) seqlock rather than NaN.
    const mailbox = mailboxFromDeviceSlots(slots({ 0: -1 }), 1);
    expect(Number.isFinite(mailbox.sequence)).toBe(true);
    expect(mailbox.sequence & 1).toBe(0);
  });
});

describe("freshRenderState", () => {
  it("returns a zeroed, independent render state each call", () => {
    const a = freshRenderState();
    const b = freshRenderState();
    expect(a).toEqual({ lastAppliedRevision: 0 });
    a.lastAppliedRevision = 5;
    expect(b.lastAppliedRevision).toBe(0);
  });
});
