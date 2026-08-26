import { ALL_EVENT_KINDS, WIDGET_API } from "../compiler/constants";
import {
  EVENT_FIELD_COMPLETIONS,
  EVENT_FIELD_HOVER_DOCS,
  lookupKindDoc,
} from "../components/eventReference";
import type { DesignerState, DesignerActions } from "../designer/store";

declare global {
  interface Window {
    __MQUICKJS_INTELLI__?: {
      eventKinds: typeof ALL_EVENT_KINDS;
      widgetApi: typeof WIDGET_API;
      eventKindSuggestions: { label: string; type: string; detail: string; apply: string }[];
      /** `event.` completions — the device contract's field union, with the
       *  same one-liners the reference rail shows (see eventReference.ts). */
      eventFields: { label: string; detail: string; kinds: string[] }[];
      /** field → one-liner, for `event.<field>` hover docs. */
      eventFieldDocs: Record<string, string>;
      /** kind string (incl. `host.rpc:0x…`) → blurb + field list, for hover. */
      lookupKindDoc: typeof lookupKindDoc;
    };
  }
}

if (typeof window !== "undefined") {
  // Pre-bake the IntelliSense payload once. CodeMirror re-reads this
  // synchronously inside its completion override so we don't pay the
  // object-literal cost on every keystroke.
  window.__MQUICKJS_INTELLI__ = {
    eventKinds: ALL_EVENT_KINDS,
    widgetApi: WIDGET_API,
    eventKindSuggestions: ALL_EVENT_KINDS.map((k) => ({
      label: k.canonical,
      type: "constant",
      detail: k.detail,
      info: k.doc.split("\n")[0],
      apply: `'${k.canonical}'`,
    })),
    eventFields: EVENT_FIELD_COMPLETIONS,
    eventFieldDocs: EVENT_FIELD_HOVER_DOCS,
    lookupKindDoc,
  };
}
