#!/usr/bin/env node

import { listLikelyBootloaderPorts } from "./lib.mjs";

const ports = await listLikelyBootloaderPorts();
console.log(JSON.stringify({
  openedAnyPort: false,
  likelySerialBootloaderPorts: ports,
  note: ports.length === 1
    ? "One likely serial port found. Verify it disappears when the F1 is unplugged before using it."
    : "Unplug/replug the F1 in bootloader mode and identify the one port that appears.",
}, null, 2));
