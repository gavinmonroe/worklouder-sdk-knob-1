#!/usr/bin/env node

import { evaluateInInput } from "./lib/input-inspector.mjs";
import { formatClock, parsePomodoroArgs } from "./lib/pomodoro-options.mjs";

const SESSION_KEY = "__framerF1PomodoroLab";

function usage() {
  return `Framer F1 Pomodoro proof

Usage:
  node framer-widgets/pomodoro.mjs start [--work-minutes 25] [--break-minutes 5] [--cycles 4]
  node framer-widgets/pomodoro.mjs demo
  node framer-widgets/pomodoro.mjs status
  node framer-widgets/pomodoro.mjs stop

The signed Input app must be running with --inspect=9230. This proof only sends
the transient v.framer.bubble RPC; it never writes files or flashes firmware.`;
}

function sdkSetupSource() {
  return `
    const { createRequire } = process.getBuiltinModule("node:module");
    const requireFromInput = createRequire(
      "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
    );
    const sdk = requireFromInput("@worklouder/wl-device-kit");
    const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1, sdk.DeviceType.Knob]);
    if (devices.length !== 1) {
      throw new Error("Expected exactly one Framer F1 / Knob1; found " + devices.length);
    }
  `;
}

function publicStateSource(session = `globalThis.${SESSION_KEY}`) {
  return `({
    status: ${session}.status,
    phase: ${session}.phase,
    cycle: ${session}.cycle,
    cycles: ${session}.cycles,
    remainingSeconds: ${session}.remainingSeconds,
    lastDisplay: ${session}.lastDisplay,
    error: ${session}.error ?? null
  })`;
}

function startSource(options) {
  const config = JSON.stringify(options);
  return `
  (async () => {
    if (globalThis.${SESSION_KEY}?.status === "running") {
      throw new Error("A Framer Pomodoro session is already running");
    }
    ${sdkSetupSource()}
    const config = ${config};
    const comm = new sdk.WLDeviceCommImpl();
    await comm.connect(devices[0]);
    const rpc = new sdk.WLRPCApi(comm).getRpcClient();
    const session = {
      status: "running",
      phase: "focus",
      cycle: 1,
      cycles: config.cycles,
      remainingSeconds: config.workSeconds,
      lastDisplay: null,
      error: null,
      stopRequested: false,
      timer: null,
      comm,
      rpc,
      deadline: Date.now() + config.workSeconds * 1000,
      async finish(status) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.stopRequested = true;
        try { await this.comm.disconnect(); } catch {}
        this.status = status;
      },
      async stop() {
        try {
          await this.rpc.sendRpcCall({
            method: "v.framer.bubble",
            params: { l: this.lastDisplay?.label ?? "POMODORO", v: "STOPPED", d: 0, s: 0 }
          });
        } catch {}
        await this.finish("stopped");
        return ${publicStateSource("this")};
      }
    };
    globalThis.${SESSION_KEY} = session;

    const show = async (label, value) => {
      await rpc.sendRpcCall({
        method: "v.framer.bubble",
        params: { l: label, v: value, d: 1, s: 1 }
      });
      session.lastDisplay = { label, value };
    };

    const tick = async () => {
      if (session.stopRequested) return;
      try {
        session.remainingSeconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
        const label = session.phase === "focus"
          ? "FOCUS " + session.cycle + "/" + session.cycles
          : "BREAK " + session.cycle + "/" + session.cycles;
        const value = (${formatClock.toString()})(session.remainingSeconds);
        if (session.lastDisplay?.value !== value || session.lastDisplay?.label !== label) {
          await show(label, value);
        }

        if (session.remainingSeconds === 0) {
          if (session.phase === "focus") {
            session.phase = "break";
            session.deadline = Date.now() + config.breakSeconds * 1000;
          } else if (session.cycle < session.cycles) {
            session.phase = "focus";
            session.cycle += 1;
            session.deadline = Date.now() + config.workSeconds * 1000;
          } else {
            await show("POMODORO", "DONE");
            await session.finish("completed");
            return;
          }
        }
        session.timer = setTimeout(tick, 200);
      } catch (error) {
        session.error = error?.message ?? String(error);
        await session.finish("error");
      }
    };

    await tick();
    return ${publicStateSource("session")};
  })()
  `;
}

function statusSource() {
  return `(() => {
    const session = globalThis.${SESSION_KEY};
    return session ? ${publicStateSource("session")} : { status: "not-started" };
  })()`;
}

function stopSource() {
  return `(async () => {
    const session = globalThis.${SESSION_KEY};
    return session ? await session.stop() : { status: "not-started" };
  })()`;
}

async function main() {
  const { command, options } = parsePomodoroArgs(process.argv.slice(2));
  if (["help", "--help", "-h"].includes(command)) {
    console.log(usage());
    return;
  }

  let source;
  if (command === "start" || command === "demo") source = startSource(options);
  else if (command === "stop") source = stopSource();
  else source = statusSource();

  const result = await evaluateInInput(source, { port: options.port });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
