import { describe, expect, it } from "vitest";

import { retireWidgetUploadDiagnostics } from "../src/designer/diagnosticLifecycle";
import type { CompileDiagnostic } from "../src/types";

describe("widget upload diagnostic lifecycle", () => {
  it("retires the previous upload attempt without hiding persistent source diagnostics", () => {
    const diagnostics: CompileDiagnostic[] = [
      {
        severity: "error",
        source: "compilation",
        message: "widget upload: Unsupported top-level statement.",
      },
      {
        severity: "warning",
        source: "compilation",
        message: "widget upload: image variants were reduced.",
      },
      { severity: "error", source: "script", message: "SyntaxError: Unexpected token" },
      { severity: "warning", source: "html", message: "Wrapper class mismatch." },
    ];

    expect(retireWidgetUploadDiagnostics(diagnostics)).toEqual(diagnostics.slice(2));
  });
});
