import { describe, expect, it } from "vitest";
import {
  referencedWidgetAssetIds,
  resolveWidgetAssetReferences,
  validateWidgetAssets,
  widgetAssetReference,
  widgetAssetTotalBytes,
} from "../src/compiler/widgetAssets";
import { buildWidgetSrcdoc, widgetPreviewToken } from "../src/compiler/widgetRuntime";
import { previewSnapshotMatches } from "../src/compiler/snapshot";

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

  it("admits the current source revision without requiring an inherited root class", () => {
    const source = {
      html: '<div class="custom-clouds">Clouds</div>',
      css: ".custom-clouds{color:white}",
      script: "",
      rootClass: "weather-v2",
      assets,
    };
    const token = widgetPreviewToken(source);
    const srcdoc = buildWidgetSrcdoc(source);

    expect(srcdoc).toContain(`<meta name="widget-preview-token" content="${token}" />`);
    expect(previewSnapshotMatches({ previewToken: token }, token)).toBe(true);
    expect(previewSnapshotMatches({ previewToken: "stale" }, token)).toBe(false);
  });

  it("changes the preview revision when an attached image changes", () => {
    const source = { html: '<img src="asset://cloud">', css: "", script: "", rootClass: "cloud", assets };
    const replacement = {
      ...source,
      assets: { cloud: { ...assets.cloud, data: "BAUG", bytes: 3 } },
    };
    expect(widgetPreviewToken(source)).not.toBe(widgetPreviewToken(replacement));
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
