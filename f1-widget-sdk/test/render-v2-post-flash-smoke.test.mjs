import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostFlashSmokeExpression,
  parsePostFlashSmokeArguments,
  runPostFlashRpcSmoke,
} from "../examples/render-v2-focus-timer/tools/post-flash-rpc-smoke.mjs";

test("post-flash smoke is explicit, bounded, and embeds only status plus fixed ID26 event", () => {
  assert.throws(() => parsePostFlashSmokeArguments([]), /--confirm-live-rpc/u);
  assert.deepEqual(parsePostFlashSmokeArguments(["--confirm-live-rpc", "--id26-host-seconds", "7920"]),
    { confirmed: true, port: 9230, hostSeconds: 7920 });
  assert.throws(() => parsePostFlashSmokeArguments(["--confirm-live-rpc", "--id26-host-seconds", "86400"]),
    /0\.\.86399/u);
  const expression = buildPostFlashSmokeExpression({ hostSeconds: 7920 });
  const envelopes = [...expression.matchAll(/decode\(("[A-Za-z0-9+/=]+")\)/gu)]
    .map((match) => JSON.parse(Buffer.from(JSON.parse(match[1]), "base64").toString("utf8")));
  assert.deepEqual(envelopes, [
    { method: "widget.scene.status", params: { protocol: "framer-widget-scene-rpc-v1" } },
    { method: "widget.v2.event", params: { id: 0xb201, value: 7920 } },
  ]);
  assert.doesNotMatch(expression, /ui\.active_screen/u);
  assert.doesNotMatch(expression, /write-flash|erase-flash|widget\.scene\.(?:begin|write|commit)/u);
});

test("post-flash smoke accepts exact status-only responses and rejects rich acknowledgments", async () => {
  const base = { target: { deviceFamily: "knob_f1", firmware: "0.4.1", usb: true },
    status: { firmwareVersion: "0.4.1" }, sceneStatus: { result: { status: "ok" } },
    hostEvent: { result: { status: "ok" } } };
  const report = await runPostFlashRpcSmoke(["--confirm-live-rpc", "--id26-host-seconds", "7920"], {
    evaluate: async () => base, log: () => {},
  });
  assert.equal(report.status, "POST_FLASH_RPC_SMOKE_OK");
  assert.equal(report.activeScreen, "manual-only: stock firmware has no active-screen RPC");
  assert.deepEqual(report.visualAcceptanceStillRequired, [
    "ID1 music metadata/art/progress",
    "ID7 WPM Pet",
    "ID26 orange shared-RTC clock, +4px header padding, and five-position 1Hz dial rotation",
    "ID27 dark sky-blue timer, +4px header padding, and five-position 1Hz dial rotation",
    "ID27 Fn+bottom-dial edit is visible immediately in five-minute steps",
    "ID27 countdown pauses while hidden and resumes without losing remaining time",
  ]);
  await assert.rejects(() => runPostFlashRpcSmoke(["--confirm-live-rpc"], {
    evaluate: async () => ({ ...base, sceneStatus: { result: { status: "ok", accepted: true } } }),
    log: () => {},
  }), /exact/u);
});
