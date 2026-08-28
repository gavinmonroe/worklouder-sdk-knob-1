import type { CompileDiagnostic } from "../types";

/** Upload diagnostics describe one assembly attempt, not persistent source state. */
export function retireWidgetUploadDiagnostics(
  diagnostics: CompileDiagnostic[],
): CompileDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.source !== "compilation" ||
      !diagnostic.message.startsWith("widget upload:"),
  );
}
