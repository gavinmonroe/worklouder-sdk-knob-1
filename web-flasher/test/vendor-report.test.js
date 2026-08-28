// The report the app writes must come from the DEVICE, not from a constant.
// A Work Louder keyboard whose vendor collection declares a different output
// report used to fail on the first write with WebHID's opaque "Failed to write
// the report" — after the connection appeared to succeed.

import { describe, expect, it } from "vitest";
import { resolveVendorOutputReport } from "../src/lib/framer-hid.js";

const vendorCollection = (reportId, dataBytes, usagePage = 0xff00) => ({
  usagePage,
  outputReports: [
    { reportId, items: [{ reportCount: dataBytes, reportSize: 8 }] },
  ],
});

describe("vendor output report resolution", () => {
  it("uses what the device declares", () => {
    const device = { collections: [vendorCollection(0x06, 63)] };
    expect(resolveVendorOutputReport(device)).toMatchObject({ reportId: 0x06, dataBytes: 63 });
  });

  it("follows a variant that declares a different id and size", () => {
    // The failure this fixes: a keyboard whose vendor report is 0x02/31 bytes.
    const device = { collections: [vendorCollection(0x02, 31)] };
    expect(resolveVendorOutputReport(device)).toMatchObject({ reportId: 0x02, dataBytes: 31 });
  });

  it("ignores non-vendor collections that also carry output reports", () => {
    const device = {
      collections: [
        { usagePage: 0x01, outputReports: [{ reportId: 0x01, items: [{ reportCount: 8, reportSize: 8 }] }] },
        vendorCollection(0x09, 47),
      ],
    };
    expect(resolveVendorOutputReport(device)).toMatchObject({ reportId: 0x09, dataBytes: 47 });
  });

  it("finds the writable report on another vendor page when 0xff00 has none", () => {
    // The Knob 1 case: it HAS a 0xff00 collection (so it connects) but that
    // collection declares nothing writable, and its raw-HID endpoint sits on
    // a different vendor page.
    const device = {
      collections: [
        { usagePage: 0xff00, inputReports: [{ reportId: 0x06, items: [{ reportCount: 63, reportSize: 8 }] }] },
        vendorCollection(0x00, 32),
      ],
    };
    const resolved = resolveVendorOutputReport(device);
    expect(resolved.reportId).toBe(0x00);
    expect(resolved.dataBytes).toBe(32);
  });

  it("still prefers 0xff00 when it does declare a writable report", () => {
    const device = {
      collections: [
        { usagePage: 0xff60, outputReports: [{ reportId: 0x09, items: [{ reportCount: 32, reportSize: 8 }] }] },
        vendorCollection(0x06, 63),
      ],
    };
    expect(resolveVendorOutputReport(device).reportId).toBe(0x06);
  });

  it("falls back to the Framer F1's report when nothing usable is declared", () => {
    // Keeps every keyboard that works today on exactly its current behaviour.
    expect(resolveVendorOutputReport({ collections: [] })).toMatchObject({ reportId: 0x06, dataBytes: 63 });
    expect(resolveVendorOutputReport({})).toMatchObject({ reportId: 0x06, dataBytes: 63 });
    const tooSmall = { collections: [vendorCollection(0x06, 2)] };
    expect(resolveVendorOutputReport(tooSmall)).toMatchObject({ reportId: 0x06, dataBytes: 63 });
  });
});

// The macOS wall: a keyboard that also declares keyboard/consumer collections
// is protected input hardware there, so Chrome opens it and then every write is
// refused until Input Monitoring is granted. The error has to SAY that — a
// person cannot guess it, and it looks identical to a broken keyboard.
describe("macOS permission guidance", () => {
  const knob1Collections = [
    { usagePage: 0x01, outputReports: [], inputReports: [] },
    { usagePage: 0x0c, inputReports: [{ reportId: 0x02, items: [{ reportCount: 2, reportSize: 8 }] }] },
    {
      usagePage: 0xff00,
      outputReports: [{ reportId: 0x06, items: [{ reportCount: 63, reportSize: 8 }] }],
      inputReports: [{ reportId: 0x06, items: [{ reportCount: 63, reportSize: 8 }] }],
    },
  ];

  it("still resolves the reported Knob 1 descriptor to the F1's own report", () => {
    // Proof the report id/size were never the problem on this hardware.
    expect(resolveVendorOutputReport({ collections: knob1Collections })).toMatchObject({
      reportId: 0x06,
      dataBytes: 63,
    });
  });
});
