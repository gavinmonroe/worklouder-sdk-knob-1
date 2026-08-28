import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FramerHidClient,
  findGrantedFramer,
  openWritableFramer,
  resolveFramerIdentity,
} from "../src/lib/framer-hid.js";

function fakeFramer() {
  const reports = [];
  return {
    vendorId: 0x303a,
    productId: 0x8396,
    serialNumber: "A4CB8FAF3210",
    collections: [{ usagePage: 0xff00 }],
    opened: true,
    reports,
    addEventListener() {},
    removeEventListener() {},
    async sendReport(reportId, data) { reports.push({ reportId, data }); },
    async close() { this.opened = false; },
  };
}

describe("Framer WebHID framing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses report 6, RPC channel 2, and 61-byte chunks", async () => {
    const device = fakeFramer();
    const client = new FramerHidClient(device);
    await client.sendMessage("x".repeat(62));

    expect(device.reports).toHaveLength(2);
    expect(device.reports[0].reportId).toBe(0x06);
    expect(device.reports[0].data).toHaveLength(63);
    expect([...device.reports[0].data.slice(0, 2)]).toEqual([2, 61]);
    expect([...device.reports[1].data.slice(0, 2)]).toEqual([2, 1]);
  });

  it("resolves a missing serial only when one supported Framer is granted", async () => {
    const device = { ...fakeFramer(), serialNumber: "" };
    vi.stubGlobal("navigator", { hid: { getDevices: async () => [device] } });
    await expect(resolveFramerIdentity(device)).resolves.toMatchObject({
      mode: "single-device",
      productId: 0x8396,
    });
  });

  it("refuses an ambiguous Framer after reboot in single-device mode", async () => {
    const first = { ...fakeFramer(), serialNumber: "" };
    const second = { ...fakeFramer(), serialNumber: "" };
    vi.stubGlobal("navigator", { hid: { getDevices: async () => [first, second] } });
    await expect(findGrantedFramer({ mode: "single-device", productId: 0x8396 }))
      .rejects.toThrow(/ambiguous/u);
  });
});

// The failure message these produce is the only thing a stranger with a
// keyboard we cannot reproduce ever sees. It is the diagnosis, so it is tested
// like one.
describe("choosing an interface Chrome will let us write to", () => {
  afterEach(() => vi.unstubAllGlobals());

  function candidate(overrides = {}) {
    const device = fakeFramer();
    return Object.assign(device, { opened: false, async open() { this.opened = true; } }, overrides);
  }

  it("keeps the entry the chooser returned when it answers", async () => {
    const picked = candidate();
    vi.stubGlobal("navigator", { hid: { getDevices: async () => [picked] } });
    const result = await openWritableFramer(picked, { verify: async () => "0.4.1" });
    expect(result.device).toBe(picked);
    expect(result.verified).toBe("0.4.1");
  });

  it("falls through to another interface for the same keyboard", async () => {
    const picked = candidate();
    const sibling = candidate();
    vi.stubGlobal("navigator", { hid: { getDevices: async () => [picked, sibling] } });
    const result = await openWritableFramer(picked, {
      verify: async (client) => {
        if (client.device === picked) throw new Error("Failed to write the report.");
        return "0.4.1";
      },
    });
    expect(result.device).toBe(sibling);
    expect(result.alternates).toBe(1);
  });

  it("reports what was tried and Chrome's verdict per report id when none accepts a write", async () => {
    const refuse = (name) => {
      const error = new Error("Failed to write the report.");
      error.name = name;
      return error;
    };
    const picked = candidate({
      // NotAllowedError = Chrome knows this id and refuses it (a protected
      // collection claims it). NotFoundError = the descriptor has no such id.
      // Telling those apart is the whole point of the probe.
      async sendReport(reportId) {
        throw refuse(reportId === 0x06 ? "NotAllowedError" : "NotFoundError");
      },
    });
    vi.stubGlobal("navigator", { hid: { getDevices: async () => [picked] } });

    const failure = await openWritableFramer(picked, {
      verify: async () => { throw refuse("NotAllowedError"); },
    }).catch((error) => error);

    expect(failure.code).toBe("no-writable-interface");
    expect(failure.message).toMatch(/Tried 1:/u);
    expect(failure.message).toMatch(/0x6=NotAllowedError/u);
    expect(failure.message).toMatch(/0x5=NotFoundError/u);
  });

  it("still fails with the real error if the diagnostic probe itself throws", async () => {
    const picked = candidate({
      async open() { throw new Error("Failed to open the device."); },
      async sendReport() { throw new Error("probe exploded"); },
    });
    vi.stubGlobal("navigator", { hid: { getDevices: async () => { throw new Error("no permission"); } } });
    await expect(openWritableFramer(picked)).rejects.toThrow(/Failed to open the device/u);
  });
});
