#!/usr/bin/env node

import { evaluateInInput } from "../../../../framer-widgets/lib/input-inspector.mjs";
import {
  buildRenderV2HostEventExpression,
  normalizeRenderV2HostEvent,
  RENDER_V2_HOST_RPC_EVENT_ID,
  RENDER_V2_HOST_RPC_METHOD,
} from "../host-event-rpc.mjs";

const value = Number(process.argv[2] ?? 7);
normalizeRenderV2HostEvent(value);
const result = await evaluateInInput(buildRenderV2HostEventExpression(value), {
  port: 9230,
  timeoutMs: 30_000,
});
const response = result?.response?.result ?? result?.response;
if (result?.target?.deviceFamily !== "knob_f1" || result?.target?.firmware !== "0.4.1" ||
    result?.target?.usb !== true || response?.status !== "ok" || Object.keys(response).length !== 1) {
  throw new Error("Render-v2 host event did not return the exact status-only acknowledgment.");
}
process.stdout.write(`${JSON.stringify({ status: "HOST_EVENT_ENQUEUED", method: RENDER_V2_HOST_RPC_METHOD,
  id: RENDER_V2_HOST_RPC_EVENT_ID, idHex: "0xB201", value, target: result.target }, null, 2)}\n`);

