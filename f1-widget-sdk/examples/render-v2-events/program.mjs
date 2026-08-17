import { createHash } from "node:crypto";

import { VIEWPORT } from "./visual.mjs";

export const HOST_RPC_EVENT_ID = 0xb201;

export function rgb565FrameToLeBuffer(frame) {
  const output = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => output.writeUInt16LE(color, index * 2));
  return output;
}

export function leBufferToRgb565Frame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== VIEWPORT.width * VIEWPORT.height * 2) {
    throw new Error("Render-v2 demo framebuffer must be the exact 62,000-byte RGB565 buffer.");
  }
  const frame = new Uint16Array(VIEWPORT.width * VIEWPORT.height);
  for (let index = 0; index < frame.length; index += 1) frame[index] = buffer.readUInt16LE(index * 2);
  return frame;
}

export function hashRgb565Frame(frame) {
  return createHash("sha256").update(rgb565FrameToLeBuffer(frame)).digest("hex");
}
