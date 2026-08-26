// The generated server is only useful if its output actually satisfies the
// schema it was generated from. These use a schema the Designer has never seen
// — deliberately not weather — because the whole point is that ANY widget can
// declare host data and get a working server.

import { describe, expect, it } from "vitest";

import { encodeSnapshot, fieldOffsets, packRecord, unpackRecord, type SnapshotSchema } from "../src/data/schemas";
import { defaultEndpoint, fieldRange, generateHostServer, serverResponseShape } from "../src/compiler/hostServer";

/** A custom widget's schema: build status + a temperature probe. */
const BUILD_SCHEMA: SnapshotSchema = {
  begin: 0xc100,
  commit: 0xc10f,
  records: {
    build: {
      id: 0xc101,
      fields: {
        passing: { bits: 1 },
        failures: { bits: 8 },
        durationSec: { bits: 12 },
        branch: { bits: 3, labels: ["main", "dev", "release"] },
      },
    },
    probe: {
      id: 0xc102,
      fields: { celsius: { bits: 9, signed: true }, humidity: { bits: 7 } },
    },
  },
};

describe("generated host server", () => {
  it("derives offsets for a schema the Designer has never seen", () => {
    expect(fieldOffsets(BUILD_SCHEMA.records.build)).toEqual({
      passing: 0, failures: 1, durationSec: 9, branch: 21,
    });
    expect(fieldOffsets(BUILD_SCHEMA.records.probe)).toEqual({ celsius: 0, humidity: 9 });
  });

  it("emits a route per record source and names the file after the widget", () => {
    const source = generateHostServer("CI Status", BUILD_SCHEMA.records ? { ci: BUILD_SCHEMA } : {});
    expect(source).toContain('"/ci": readCi');
    expect(source).toContain("CI Status host on http://localhost:");
    expect(source).toContain("node:http");
    // No protocol knowledge should leak into a user's server. Comments may
    // mention begin/commit to explain what the server does NOT have to do, so
    // strip them and assert against the actual code.
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/>>>|<<[^=]|0x3ff/);
    expect(code).not.toMatch(/\bbegin\b|\bcommit\b/i);
  });

  it("documents every field's width, offset and range in the generated source", () => {
    const source = generateHostServer("CI Status", { ci: BUILD_SCHEMA });
    expect(source).toContain("passing: 1, // 1 bits @0, 0..1");
    expect(source).toContain("celsius: 1, // 9 bits @0, -256..255");
    expect(source).toContain("labels: main, dev, release");
  });

  it("produces starter values that pack without error", () => {
    const values = serverResponseShape(BUILD_SCHEMA);
    for (const [name, record] of Object.entries(BUILD_SCHEMA.records)) {
      expect(() => packRecord(record, values[name])).not.toThrow();
    }
  });

  it("round-trips the server's own response through the widget's decoder", () => {
    const values = serverResponseShape(BUILD_SCHEMA);
    const events = encodeSnapshot(BUILD_SCHEMA, 3, values);
    expect(events.map((e) => e.id)).toEqual([0xc100, 0xc101, 0xc102, 0xc10f]);
    const build = unpackRecord(BUILD_SCHEMA.records.build, events[1].value);
    expect(build).toMatchObject(values.build);
    const probe = unpackRecord(BUILD_SCHEMA.records.probe, events[2].value);
    expect(probe).toMatchObject(values.probe);
  });

  it("refuses to generate a server for a widget with no host data", () => {
    expect(() => generateHostServer("Plain", {})).toThrow(/no host-data schemas/);
  });

  it("reports ranges honestly for signed and unsigned fields", () => {
    expect(fieldRange(9, true)).toBe("-256..255");
    expect(fieldRange(8, false)).toBe("0..255");
  });

  it("suggests an endpoint derived from the schema name", () => {
    expect(defaultEndpoint("ci")).toBe("http://localhost:842/ci");
    expect(defaultEndpoint("Build Status")).toBe("http://localhost:842/build-status");
  });
});
