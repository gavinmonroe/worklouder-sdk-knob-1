import { describe, expect, it } from "vitest";
import {
  referencedWidgetAssetIds,
  resolveWidgetAssetReferences,
  validateWidgetAssets,
  widgetAssetReference,
  widgetAssetTotalBytes,
} from "../src/compiler/widgetAssets";
import { buildWidgetSrcdoc } from "../src/compiler/widgetRuntime";

const assets = {
  cloud: {
    id: "cloud",
    name: "cloud.png",
    mimeType: "image/png" as const,
    data: "AQID",
    bytes: 3,
    width: 24,
    height: 12,
  },
};

describe("widget image assets", () => {
  it("resolves the same portable URL in HTML and CSS", () => {
    const data = "data:image/png;base64,AQID";
    expect(resolveWidgetAssetReferences('<img src="asset://cloud">', assets)).toBe(`<img src="${data}">`);
    expect(resolveWidgetAssetReferences('.cloud{background:url("asset://cloud")}', assets))
      .toBe(`.cloud{background:url("${data}")}`);
  });

  it("makes the sandboxed preview self-contained before it loads", () => {
    const srcdoc = buildWidgetSrcdoc({
      html: '<img class="cloud" src="asset://cloud">',
      css: '.cloud{background-image:url("asset://cloud")}',
      script: "",
      rootClass: "cloud",
      assets,
    });
    expect(srcdoc).not.toContain("asset://cloud");
    expect(srcdoc.match(/data:image\/png;base64,AQID/gu)).toHaveLength(2);
  });

  it("leaves missing refs intact so diagnostics can name them", () => {
    expect(resolveWidgetAssetReferences("asset://missing", assets)).toBe("asset://missing");
  });

  it("collects and deduplicates refs deterministically", () => {
    expect(referencedWidgetAssetIds("asset://cloud asset://sprite", "asset://cloud")).toEqual(["cloud", "sprite"]);
  });

  it("validates byte counts and totals from canonical base64", () => {
    expect(validateWidgetAssets(assets)).toEqual(assets);
    expect(widgetAssetTotalBytes(assets)).toBe(3);
    expect(widgetAssetReference("cloud")).toBe("asset://cloud");
    expect(() => validateWidgetAssets({ cloud: { ...assets.cloud, bytes: 4 } })).toThrow(/byte count/);
  });
});
