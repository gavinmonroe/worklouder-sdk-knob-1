import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FramerHidClient,
  findGrantedFramer,
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
