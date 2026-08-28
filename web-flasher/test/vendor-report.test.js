// The report the app writes must come from the DEVICE, not from a constant.
// A Work Louder keyboard whose vendor collection declares a different output
// report used to fail on the first write with WebHID's opaque "Failed to write
// the report" — after the connection appeared to succeed.

import { describe, expect, it } from "vitest";
import { resolveVendorOutputReport } from "../src/lib/framer-hid.js";

const vendorCollection = (reportId, dataBytes) => ({
  usagePage: 0xff00,
  outputReports: [
    { reportId, items: [{ reportCount: dataBytes, reportSize: 8 }] },
  ],
});

describe("vendor output report resolution", () => {
  it("uses what the device declares", () => {
    const device = { collections: [vendorCollection(0x06, 63)] };
    expect(resolveVendorOutputReport(device)).toEqual({ reportId: 0x06, dataBytes: 63 });
  });

  it("follows a variant that declares a different id and size", () => {
    // The failure this fixes: a keyboard whose vendor report is 0x02/31 bytes.
    const device = { collections: [vendorCollection(0x02, 31)] };
    expect(resolveVendorOutputReport(device)).toEqual({ reportId: 0x02, dataBytes: 31 });
  });

  it("ignores non-vendor collections that also carry output reports", () => {
    const device = {
      collections: [
        { usagePage: 0x01, outputReports: [{ reportId: 0x01, items: [{ reportCount: 8, reportSize: 8 }] }] },
        vendorCollection(0x09, 47),
      ],
    };
    expect(resolveVendorOutputReport(device)).toEqual({ reportId: 0x09, dataBytes: 47 });
  });

  it("falls back to the Framer F1's report when nothing usable is declared", () => {
    // Keeps every keyboard that works today on exactly its current behaviour.
    expect(resolveVendorOutputReport({ collections: [] })).toEqual({ reportId: 0x06, dataBytes: 63 });
    expect(resolveVendorOutputReport({})).toEqual({ reportId: 0x06, dataBytes: 63 });
    const tooSmall = { collections: [vendorCollection(0x06, 2)] };
    expect(resolveVendorOutputReport(tooSmall)).toEqual({ reportId: 0x06, dataBytes: 63 });
  });
});
