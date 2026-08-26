// Dev-only screenshot harness for the Screens panel (docs/17).
//
// The panel's slot cards only appear against a real slot-bank device, which no
// browser here can reach. This mounts the PURE ScreensView with mock models so
// every state — disconnected, scanning, unsupported, a fresh bank, and a full
// mixed bank — renders in both themes for visual verification. Never part of
// the app bundle: it has its own html entry and is not imported by main.tsx.

import React from "react";
import ReactDOM from "react-dom/client";
import { ToastProvider } from "./components/toast";
import { ScreensView, type ScreensViewProps } from "./components/ScreensPanel";
import type { SlotBankModel } from "./device/widget-upload";
import "./styles/index.css";

const NAMES: Record<string, string> = {
  "1a2b3c4d5e6f70819a0b1c2d3e4f5061": "Weather (device DSL)",
  "aabbccddeeff00112233445566778899": "WPM Pet",
  "5566778899aabbccddeeff0011223344": "Clock face",
};
const nameForSha = (sha16: string) => NAMES[sha16] ?? null;

const mixedBank: SlotBankModel = {
  running: 7,
  activeSlot: 0,
  slotCount: 4,
  slots: [
    { slot: 0, present: true, active: true, generation: 7, sha16: "1a2b3c4d5e6f70819a0b1c2d3e4f5061", nextGeneration: 8, unknown: false },
    { slot: 1, present: true, active: false, generation: 3, sha16: "aabbccddeeff00112233445566778899", nextGeneration: 4, unknown: false },
    { slot: 2, present: true, active: false, generation: 1, sha16: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", nextGeneration: 2, unknown: false },
    { slot: 3, present: false, active: false, generation: 0, sha16: "", nextGeneration: 1, unknown: false },
  ],
};

const freshBank: SlotBankModel = {
  running: 2,
  activeSlot: 0,
  slotCount: 4,
  slots: [
    { slot: 0, present: true, active: true, generation: 2, sha16: "5566778899aabbccddeeff0011223344", nextGeneration: 3, unknown: false },
    { slot: 1, present: false, active: false, generation: 0, sha16: "", nextGeneration: 1, unknown: false },
    { slot: 2, present: false, active: false, generation: 0, sha16: "", nextGeneration: 1, unknown: false },
    { slot: 3, present: false, active: false, generation: 0, sha16: "", nextGeneration: 1, unknown: false },
  ],
};

const busyBank: SlotBankModel = {
  running: 7,
  activeSlot: 0,
  slotCount: 4,
  slots: mixedBank.slots,
};

const noop = () => {};

const base: Omit<ScreensViewProps, "phase" | "model"> = {
  canAct: true,
  nameForSha,
  onRefresh: noop,
  onIdentify: noop,
  onActivate: noop,
  onPush: noop,
};

const CASES: { title: string; props: ScreensViewProps }[] = [
  { title: "Full bank — active, stored (named + unnamed), empty", props: { ...base, phase: "ready", model: mixedBank } },
  { title: "Fresh device — one live widget, three open slots", props: { ...base, phase: "ready", model: freshBank } },
  { title: "Pushing to slot 3 (busy)", props: { ...base, phase: "ready", model: busyBank, canAct: false, busySlot: 3, busyKind: "push" } },
  { title: "Scanning", props: { ...base, phase: "scanning", model: null } },
  { title: "Disconnected", props: { ...base, phase: "disconnected", model: null } },
  { title: "Needs identify", props: { ...base, phase: "needs-identify", model: null } },
  { title: "Unsupported firmware (single slot)", props: { ...base, phase: "unsupported", model: null } },
  { title: "Sweep error", props: { ...base, phase: "error", model: null, error: "The widget upload RPC did not answer its status probe (op 0)." } },
];

function Toolbar() {
  const set = (t: "light" | "dark" | "system") => {
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
      <button className="wd-btn" data-size="sm" onClick={() => set("light")}>Light</button>
      <button className="wd-btn" data-size="sm" onClick={() => set("dark")}>Dark</button>
      <button className="wd-btn" data-size="sm" onClick={() => set("system")}>System</button>
    </div>
  );
}

function Gallery() {
  return (
    <ToastProvider>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px 80px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Screens panel — states</h1>
        <p className="text-tertiary text-sm" style={{ marginBottom: 20 }}>
          docs/17 multi-widget slot bank · mock data · ScreensView (pure)
        </p>
        <Toolbar />
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {CASES.map((c) => (
            <section key={c.title}>
              <div className="wd-overline" style={{ marginBottom: 8 }}>{c.title}</div>
              <ScreensView {...c.props} />
            </section>
          ))}
        </div>
      </div>
    </ToastProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>,
);
