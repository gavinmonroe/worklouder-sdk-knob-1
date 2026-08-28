import { describe, expect, it } from "vitest";

import { applyDesignerMeta } from "../src/designer/meta";
import type { DesignerWidget } from "../src/types";

const widget: DesignerWidget = {
  name: "Weather",
  rootClass: "weather-v2",
  html: '<div class="weather-v2"></div>',
  css: ".weather-v2 {}",
  script: '"use strict";\nwidget.on("tick.1s", function () {});',
};

describe("applyDesignerMeta", () => {
  it("maps the editable display name to the widget model's name field", () => {
    const renamed = applyDesignerMeta(widget, { displayName: "Floating clouds" });

    expect(renamed.name).toBe("Floating clouds");
    expect(renamed.rootClass).toBe("weather-v2");
    expect(renamed).not.toHaveProperty("displayName");
  });

  it("updates either field independently and permits an empty display name", () => {
    expect(applyDesignerMeta(widget, { rootClass: "cloud-sky" })).toMatchObject({
      name: "Weather",
      rootClass: "cloud-sky",
    });
    expect(applyDesignerMeta(widget, { displayName: "" }).name).toBe("");
  });
});
