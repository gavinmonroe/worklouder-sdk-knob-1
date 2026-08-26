// The SVG assembly is the part that can silently produce an unrenderable
// document (the <img> just fires onerror and the user gets the box-model
// fallback with no idea why). These pin the shape and the XML hazards.
//
// Well-formedness itself is checked against a real parser in the browser --
// this environment has no DOM -- see the snapshot check in the designer's
// browser verification.

import { describe, expect, it } from "vitest";

import { buildSnapshotSvg } from "../src/compiler/snapshot";

describe("snapshot SVG assembly", () => {
  it("wraps the body at the exact device geometry", () => {
    const svg = buildSnapshotSvg("<div>hi</div>", ".a{color:red}");
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="310"');
    expect(svg).toContain('viewBox="0 0 100 310"');
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg).toContain("<div>hi</div>");
  });

  it("carries the base backdrop ahead of author CSS so precedence matches the iframe", () => {
    const svg = buildSnapshotSvg("<div/>", ".a{color:red}");
    const base = svg.indexOf("background:#000");
    const author = svg.indexOf(".a{color:red}");
    expect(base).toBeGreaterThan(-1);
    expect(author).toBeGreaterThan(base);
  });

  it("splits a CDATA terminator hidden in author CSS", () => {
    // A naive CDATA wrap would end the section early here and corrupt the doc.
    const svg = buildSnapshotSvg("<div/>", '.x{content:"]]>"}');
    expect(svg).toContain("]]]]><![CDATA[>");
    // Exactly one section opens and one closes.
    expect(svg.match(/<!\[CDATA\[/g)).toHaveLength(2);
    expect(svg.split("]]></style>")).toHaveLength(2);
  });

  it("keeps CSS verbatim inside CDATA rather than entity-escaping it", () => {
    const svg = buildSnapshotSvg("<div/>", ".a > .b { width: calc(100% - 2px); }");
    expect(svg).toContain(".a > .b { width: calc(100% - 2px); }");
    expect(svg).not.toContain("&gt;");
  });

  it("declares the SVG namespace on the root element", () => {
    const svg = buildSnapshotSvg("<div/>", "");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });
});
