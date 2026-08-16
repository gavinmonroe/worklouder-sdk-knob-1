#!/usr/bin/env node

import { createDemoTimeline } from "./lib/wpm-pet-model.mjs";

function usage() {
  return `Framer F1 WPM pet — hardware-free prototype

Usage:
  node framer-widgets/wpm-pet.mjs demo
  node framer-widgets/wpm-pet.mjs rpc-demo

demo prints state changes and five-second checkpoints. rpc-demo emits the exact
v.framer.bubble JSON requests for those checkpoints. Neither command connects
to Input, opens HID, writes the device filesystem, or flashes firmware.`;
}

function checkpoints(timeline) {
  let previousState;
  return timeline.filter((frame) => {
    const stateChanged = frame.state !== previousState;
    previousState = frame.state;
    return stateChanged || frame.atMs % 5_000 === 0;
  });
}

function printDemo(frames) {
  console.log(" time   pet        face    current  average  high  low  words");
  for (const frame of frames) {
    const seconds = (frame.atMs / 1000).toFixed(1).padStart(5);
    const metric = (value) => (value === null ? "--" : String(value)).padStart(4);
    console.log(
      `${seconds}s  ${frame.state.padEnd(9)} ${frame.face.padEnd(7)} ${metric(frame.currentWpm)}` +
        `     ${metric(frame.averageWpm)}  ${metric(frame.highWpm)} ${metric(frame.lowWpm)}` +
        `  ${String(frame.completedWords).padStart(4)}`,
    );
  }
}

const command = process.argv[2] ?? "demo";
if (["help", "--help", "-h"].includes(command)) {
  console.log(usage());
} else if (command === "demo") {
  printDemo(checkpoints(createDemoTimeline()));
} else if (command === "rpc-demo") {
  for (const frame of checkpoints(createDemoTimeline())) {
    console.log(JSON.stringify({ atMs: frame.atMs, ...frame.request }));
  }
} else {
  console.error(`Error: unknown command ${command}\n\n${usage()}`);
  process.exitCode = 1;
}
