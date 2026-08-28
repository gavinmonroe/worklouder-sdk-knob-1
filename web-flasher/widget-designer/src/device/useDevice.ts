// ─────────────────────────────────────────────────────────────────────────────
// Device workflow hook for the designer.
//
//   detect → connect → identify (read-only) → select target screen → build → push.
//
// Identification is read-only and definitive: the mquickjs capability page 1
// advertises the base-app SHA-256, which maps to the firmware catalog. The
// screen roster comes from capability page 12 (screenIds=...).
//
// The push step is deliberately NOT auto-triggered and is gated on the
// device's advertised capability.
//
// Two push paths, each gated by what the device advertises:
//   * `push` targets the render-v2 scene RPC (RAM scene store, never flash),
//     only on builds advertising the generic structural profile — see
//     probeRenderV2Capability().genericPackages.
//   * `pushWidget` targets `widget.mquickjs.upload`, ONLY on builds whose cap
//     page 0 reads `uploader=1` (runtimeUploader). On the historical builds the
//     mquickjs surface is read-only (`uploader=0` is a compile-time literal in
//     runtime_proof.c) and this path stays unreachable, leaving behavior
//     identical to before it existed. A widget push persists to the widget
//     flash slot and is adopted at the next power-cycle.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from "react";
import { FramerHidClient } from "@flasher/src/lib/framer-hid.js";
import {
  connectFramer,
  probeMQuickJsCapability,
  probeRenderV2Capability,
  identifyFirmwareFromCapabilities,
  type ConnectedFramer,
  type MQuickJsCapability,
  type RenderV2Capability,
  type IdentificationSource,
} from "./device-rpc";
import type { FirmwareEntry } from "./firmware-catalog";
import { pushRenderV2Package, type ScenePushResult } from "./scene-push";
import {
  activateWidgetSlot,
  buildSlotBank,
  nextSlotGeneration,
  probeWidgetInventory,
  probeWidgetUploadStatus,
  pushWidgetUpload,
  type SlotBankModel,
  type WidgetUploadResult,
} from "./widget-upload";
import type { RenderV2Package } from "../compiler/renderV2Package";

export type DevicePhase =
  | "idle"
  | "connecting"
  | "connected"
  | "identifying"
  | "ready"
  | "error";

export interface DeviceState {
  phase: DevicePhase;
  error: string;
  connected: ConnectedFramer | null;
  mquickjs: MQuickJsCapability | null;
  renderV2: RenderV2Capability | null;
  firmware: FirmwareEntry | null;
  firmwareKnown: boolean;
  /** Which route identified the firmware; the SHA route is definitive. */
  firmwareSource: IdentificationSource;
  selectedScreen: number | null;
  /** True while a scene push is in flight. */
  pushing: boolean;
  /**
   * The device's committed generation, tracked locally: it cannot be read back
   * without the capabilities RPC, which crashes this firmware. A fresh boot of
   * the generic build is 0 (noBootProgram=true); each commit advances it.
   */
  committedGeneration: number;
  /** True once a push has committed this boot; the firmware allows repeat=1. */
  pushedThisBoot: boolean;
  // ── Multi-widget slot bank (docs/17), additive ───────────────────────────
  /** The last op-0 + op-5 sweep, or null before the first sweep / on a build
   *  without the slot bank. */
  slotBank: SlotBankModel | null;
  /** Sweep lifecycle for the Screens panel. */
  slotScan: "idle" | "scanning" | "ready" | "error";
  /** Sweep failure text ("" when none). */
  slotError: string;
  /** Which slot is mid-push/activate, for per-card busy state. */
  slotBusy: { slot: number; kind: "push" | "activate" } | null;
  log: string[];
}

const MAX_LOG = 200;

export function useDevice() {
  const [state, setState] = useState<DeviceState>({
    phase: "idle",
    error: "",
    connected: null,
    mquickjs: null,
    renderV2: null,
    firmware: null,
    firmwareKnown: false,
    firmwareSource: "none",
    selectedScreen: null,
    pushing: false,
    committedGeneration: 0,
    pushedThisBoot: false,
    slotBank: null,
    slotScan: "idle",
    slotError: "",
    slotBusy: null,
    log: [],
  });

  const clientRef = useRef<FramerHidClient | null>(null);

  const appendLog = useCallback((line: string) => {
    if (!line) return;
    setState((s) => ({ ...s, log: [...s.log, line].slice(-MAX_LOG) }));
  }, []);

  const closeClient = useCallback(async () => {
    const client = clientRef.current;
    clientRef.current = null;
    if (client) await client.close().catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, phase: "connecting", error: "", log: [] }));
    try {
      // Close any client still open from a previous connect before opening a
      // new one, so a re-connect never leaves two sessions on the endpoint.
      await closeClient();

      const { client, ...connected } = await connectFramer();
      appendLog(`Connected Framer F1 ${connected.layout} on firmware ${connected.version}.`);
      if (connected.identity.mode === "single-device") {
        appendLog("Chrome did not expose the HID serial; single-device mode.");
      }
      clientRef.current = client;

      setState((s) => ({
        ...s,
        phase: "connected",
        connected,
        mquickjs: null,
        renderV2: null,
        firmware: null,
        firmwareKnown: false,
        selectedScreen: null,
      }));
    } catch (cause) {
      setState((s) => ({ ...s, phase: "error", error: (cause as Error).message }));
    }
  }, [appendLog, closeClient]);

  const identify = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      setState((s) => ({ ...s, phase: "error", error: "Connect a keyboard first." }));
      return;
    }
    setState((s) => ({ ...s, phase: "identifying", error: "" }));
    try {
      const mquickjs = await probeMQuickJsCapability(client);
      const renderV2 = await probeRenderV2Capability(client);
      const { firmware, source } = identifyFirmwareFromCapabilities(mquickjs, renderV2);

      appendLog(`MicroQuickJS: ${mquickjs.gate}.`);
      if (mquickjs.baseAppSha256) {
        appendLog(`Base app SHA-256: ${mquickjs.baseAppSha256.slice(0, 16)}…`);
      }
      if (firmware && source === "app-sha256") {
        appendLog(`Firmware identified: ${firmware.name} (${firmware.id}).`);
      } else if (firmware) {
        appendLog(
          `Firmware inferred from its advertised profile: ${firmware.name} (${firmware.id}). ` +
            "This build carries no mquickjs module, so it advertises no app SHA-256 to match exactly.",
        );
      } else {
        appendLog("Firmware advertises neither an app SHA-256 nor a known render-v2 profile.");
      }
      if (mquickjs.screenIds.length > 0) {
        appendLog(`Screen roster: ${mquickjs.screenIds.join(", ")}.`);
      }
      if (renderV2.present) {
        appendLog(`Render-v2: ${renderV2.gate}.`);
        if (renderV2.committedGeneration !== null) {
          appendLog(`Device committed generation ${renderV2.committedGeneration}.`);
        }
      } else {
        appendLog("Render-v2 scene RPC did not answer.");
      }

      setState((s) => ({
        ...s,
        phase: "ready",
        mquickjs,
        renderV2,
        firmware,
        firmwareKnown: firmware !== null,
        firmwareSource: source,
        // The device reports this directly on 4e045ec2+; fall back to whatever
        // we have tracked locally when it does not.
        committedGeneration: renderV2.committedGeneration ?? s.committedGeneration,
      }));
    } catch (cause) {
      setState((s) => ({ ...s, phase: "error", error: (cause as Error).message }));
    }
  }, [appendLog]);

  const selectScreen = useCallback((screenId: number) => {
    setState((s) => ({ ...s, selectedScreen: screenId }));
  }, []);

  /**
   * Push a built render-v2 package over the scene RPC. RAM-only: the scene
   * store is not flash, so a power cycle returns the keyboard to whatever it
   * boot-adopts. Nothing here writes a flash region.
   */
  const push = useCallback(
    async (pkg: RenderV2Package): Promise<ScenePushResult | null> => {
      const client = clientRef.current;
      if (!client) {
        setState((s) => ({ ...s, error: "Connect a keyboard first." }));
        return null;
      }
      setState((s) => ({ ...s, pushing: true, error: "" }));
      try {
        const result = await pushRenderV2Package({
          rpc: (method, params) => client.call(method, params),
          package: pkg,
          expectedGeneration: state.committedGeneration,
          onProgress: (progress) => {
            if (progress.stage === "uploading-chunks" && progress.current !== undefined) {
              if (progress.current === 0 || progress.current === progress.total) {
                appendLog(`Uploading ${progress.total} chunks…`);
              }
            } else if (progress.message) {
              appendLog(progress.message);
            }
          },
        });
        appendLog(
          `Pushed ${result.bytes.toLocaleString()} B in ${result.totalChunks} chunks — generation ${result.generation} committed.`,
        );
        setState((s) => ({
          ...s,
          pushing: false,
          committedGeneration: result.generation,
          pushedThisBoot: true,
        }));
        return result;
      } catch (cause) {
        const message = (cause as Error).message;
        appendLog(`Push failed: ${message}`);
        setState((s) => ({ ...s, pushing: false, error: message }));
        return null;
      }
    },
    [appendLog, state.committedGeneration],
  );

  /**
   * Push an assembled widget over `widget.mquickjs.upload` — the parallel
   * mquickjs path, live ONLY on firmware that advertises `uploader=1` on cap
   * page 0 (runtimeUploader). Unlike the scene push this persists to the
   * widget flash slot; adoption happens at the NEXT power-cycle, never hot.
   *
   * The container's generation is baked and sha-pinned, so the device's
   * running generation is read FIRST and the caller assembles at exactly
   * running + 1.
   */
  const pushWidget = useCallback(
    async (
      assemble: (generation: number) => Promise<{ binary: Uint8Array; sha256: string; bytes: number }>,
    ): Promise<WidgetUploadResult | null> => {
      const client = clientRef.current;
      if (!client) {
        setState((s) => ({ ...s, error: "Connect a keyboard first." }));
        return null;
      }
      if (state.mquickjs?.runtimeUploader !== true) {
        setState((s) => ({
          ...s,
          error: "This firmware does not advertise the mquickjs uploader (uploader=1).",
        }));
        return null;
      }
      setState((s) => ({ ...s, pushing: true, error: "" }));
      try {
        const rpc = (method: string, params: Record<string, unknown>) => client.call(method, params);
        const status = await probeWidgetUploadStatus(rpc);
        if (!status) {
          throw new Error("The widget upload RPC did not answer its status probe.");
        }
        const generation = status.g + 1;
        appendLog(`Device runs widget generation ${status.g}; assembling generation ${generation}.`);
        const container = await assemble(generation);
        appendLog(
          `Assembled F2UP ${container.bytes.toLocaleString()} B (sha ${container.sha256.slice(0, 16)}…).`,
        );
        const result = await pushWidgetUpload({
          rpc,
          container,
          generation,
          onProgress: (progress) => {
            if (progress.stage === "uploading-chunks" && progress.current !== undefined) {
              if (progress.current === 0 || progress.current === progress.total) {
                appendLog(`Uploading ${progress.total} chunks…`);
              }
            } else if (progress.message) {
              appendLog(progress.message);
            }
          },
        });
        appendLog(
          `Widget generation ${result.generation} persisted (${result.chunks} chunks). ` +
            "Power-cycle the keyboard to adopt it — adoption happens at boot.",
        );
        setState((s) => ({ ...s, pushing: false }));
        return result;
      } catch (cause) {
        const message = (cause as Error).message;
        appendLog(`Widget push failed: ${message}`);
        setState((s) => ({ ...s, pushing: false, error: message }));
        return null;
      }
    },
    [appendLog, state.mquickjs],
  );

  /**
   * Sweep the slot bank: op 0 (for sl/sn + running generation) then op 5 per
   * slot, folded into the model the Screens panel renders. Read-only — the same
   * transport the push path uses, no flash write. `silent` refreshes the model
   * in place (after an activate/push) without flashing the whole grid back to
   * the scanning skeleton.
   */
  const sweepSlots = useCallback(
    async (options?: { silent?: boolean }): Promise<SlotBankModel | null> => {
      const client = clientRef.current;
      if (!client) {
        setState((s) => ({ ...s, slotScan: "error", slotError: "Connect a keyboard first." }));
        return null;
      }
      if (state.mquickjs?.runtimeUploader !== true) {
        // No slot bank on this build — the panel shows the unsupported state.
        return null;
      }
      const rpc = (method: string, params: Record<string, unknown>) => client.call(method, params);
      if (!options?.silent) setState((s) => ({ ...s, slotScan: "scanning", slotError: "" }));
      try {
        const status = await probeWidgetUploadStatus(rpc);
        if (!status) {
          throw new Error("The widget upload RPC did not answer its status probe (op 0).");
        }
        const slotCount = Math.max(1, status.sn ?? 1);
        const inventories = [];
        for (let k = 0; k < slotCount; k += 1) {
          inventories.push(await probeWidgetInventory(rpc, k));
        }
        const model = buildSlotBank(status, inventories);
        setState((s) => ({ ...s, slotBank: model, slotScan: "ready", slotError: "" }));
        if (!options?.silent) {
          const occupied = model.slots.filter((slot) => slot.present).length;
          appendLog(
            `Swept ${model.slotCount} widget slot${model.slotCount === 1 ? "" : "s"} — ` +
              `${occupied} occupied, slot ${model.activeSlot} live.`,
          );
        }
        return model;
      } catch (cause) {
        const message = (cause as Error).message;
        setState((s) => ({ ...s, slotScan: "error", slotError: message }));
        appendLog(`Slot sweep failed: ${message}`);
        return null;
      }
    },
    [appendLog, state.mquickjs],
  );

  /**
   * Activate a slot (op 6): make its stored widget the live one, in place, no
   * power-cycle. Refuses an empty slot (the device returns rc != 0 and leaves
   * the running widget undisturbed). Re-sweeps silently so the active marker
   * follows the switch.
   */
  const activateSlot = useCallback(
    async (slot: number): Promise<boolean> => {
      const client = clientRef.current;
      if (!client) {
        setState((s) => ({ ...s, error: "Connect a keyboard first." }));
        return false;
      }
      if (state.mquickjs?.runtimeUploader !== true) {
        setState((s) => ({
          ...s,
          error: "This firmware does not advertise the mquickjs uploader (uploader=1).",
        }));
        return false;
      }
      const rpc = (method: string, params: Record<string, unknown>) => client.call(method, params);
      setState((s) => ({ ...s, slotBusy: { slot, kind: "activate" }, error: "" }));
      try {
        const reply = await activateWidgetSlot(rpc, slot);
        if (!reply) {
          throw new Error(
            `Slot ${slot} activation returned no parseable reply; the keyboard state is indeterminate.`,
          );
        }
        if (reply.rc !== 0) {
          throw new Error(
            `Slot ${slot} activation was rejected (rc=${reply.rc}) — an empty slot cannot be activated.`,
          );
        }
        appendLog(`Activated slot ${slot} — now the live widget (generation ${reply.g}).`);
        setState((s) => ({ ...s, slotBusy: null }));
        await sweepSlots({ silent: true });
        return true;
      } catch (cause) {
        const message = (cause as Error).message;
        appendLog(`Slot ${slot} activation failed: ${message}`);
        setState((s) => ({ ...s, slotBusy: null, error: message }));
        return false;
      }
    },
    [appendLog, state.mquickjs, sweepSlots],
  );

  /**
   * Push an assembled widget to a SPECIFIC slot (op 1 with slot=k). Reads that
   * slot's inventory first (op 5) so the caller assembles at exactly the slot's
   * persisted generation + 1 — a first push to an empty slot is generation 1.
   * Mirrors `pushWidget`, but ratchets per-slot instead of against the running
   * widget. Returns the result plus the pushed widget's f2js sha16 so the caller
   * can name it in the local registry.
   */
  const pushWidgetToSlot = useCallback(
    async (
      slot: number,
      assemble: (
        generation: number,
      ) => Promise<{ binary: Uint8Array; bytes: number; sections: { f2js: { sha256: string } } }>,
    ): Promise<{ result: WidgetUploadResult; sha16: string } | null> => {
      const client = clientRef.current;
      if (!client) {
        setState((s) => ({ ...s, error: "Connect a keyboard first." }));
        return null;
      }
      if (state.mquickjs?.runtimeUploader !== true) {
        setState((s) => ({
          ...s,
          error: "This firmware does not advertise the mquickjs uploader (uploader=1).",
        }));
        return null;
      }
      setState((s) => ({ ...s, pushing: true, slotBusy: { slot, kind: "push" }, error: "" }));
      try {
        const rpc = (method: string, params: Record<string, unknown>) => client.call(method, params);
        const inv = await probeWidgetInventory(rpc, slot);
        if (!inv) {
          throw new Error(`Could not read slot ${slot} inventory (op 5); refusing to push blind.`);
        }
        const generation = nextSlotGeneration(inv);
        appendLog(
          `Slot ${slot} holds generation ${inv.present ? inv.g : 0}; assembling generation ${generation}.`,
        );
        const container = await assemble(generation);
        const sha16 = container.sections.f2js.sha256.slice(0, 32).toLowerCase();
        appendLog(`Assembled F2UP ${container.bytes.toLocaleString()} B (f2js sha ${sha16}…).`);
        const result = await pushWidgetUpload({
          rpc,
          container,
          generation,
          slot,
          onProgress: (progress) => {
            if (progress.stage === "uploading-chunks" && progress.current !== undefined) {
              if (progress.current === 0 || progress.current === progress.total) {
                appendLog(`Uploading ${progress.total} chunks…`);
              }
            } else if (progress.message) {
              appendLog(progress.message);
            }
          },
        });
        appendLog(
          // The log is evidence, so it keeps the slot index and the generation
          // the wire actually carried — but the moment it names a CONTROL it
          // has to use that control's label. The Screens card's button is
          // called "Put on screen"; "Activate it" sends the reader hunting for
          // a button that is not there.
          `Widget generation ${result.generation} persisted to slot ${slot} (${result.chunks} chunks). ` +
            'Choose "Put on screen" to show it now, or power-cycle — the highest generation boots.',
        );
        setState((s) => ({ ...s, pushing: false, slotBusy: null }));
        await sweepSlots({ silent: true });
        return { result, sha16 };
      } catch (cause) {
        const message = (cause as Error).message;
        appendLog(`Slot ${slot} push failed: ${message}`);
        setState((s) => ({ ...s, pushing: false, slotBusy: null, error: message }));
        return null;
      }
    },
    [appendLog, state.mquickjs, sweepSlots],
  );

  const disconnect = useCallback(async () => {
    await closeClient();
    setState((s) => ({
      ...s,
      phase: "idle",
      connected: null,
      mquickjs: null,
      renderV2: null,
      firmware: null,
      firmwareKnown: false,
      firmwareSource: "none",
      selectedScreen: null,
      pushing: false,
      committedGeneration: 0,
      pushedThisBoot: false,
      slotBank: null,
      slotScan: "idle",
      slotError: "",
      slotBusy: null,
      error: "",
    }));
  }, [closeClient]);

  return {
    state,
    /** The open HID client, for callers that need a raw device command the
     *  hook does not wrap — firmware install uses it to ask the keyboard to
     *  restart into its bootloader. Null whenever nothing is connected. */
    client: () => clientRef.current,
    connect,
    identify,
    selectScreen,
    push,
    pushWidget,
    sweepSlots,
    activateSlot,
    pushWidgetToSlot,
    disconnect,
    appendLog,
  };
}
