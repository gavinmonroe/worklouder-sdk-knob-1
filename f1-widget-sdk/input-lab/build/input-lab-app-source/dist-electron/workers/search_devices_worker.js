import { parentPort as o } from "worker_threads";
import e from "electron-log";
import { WLDeviceDiscovery as d } from "@worklouder/wl-device-kit";
var s = /* @__PURE__ */ ((r) => (r.shutdown = "shutdown", r.searchDevices = "searchDevices", r.result = "searchDevicesResult", r.error = "searchDevicesError", r))(s || {});
if (!o) throw new Error("Must be run as a worker thread");
const v = {
  info: e.info,
  error: e.error,
  debug: e.debug,
  warn: e.warn
}, n = new d(v);
o.on("message", async (r) => {
  var c;
  if (r === s.shutdown && (e.info("|search_devices_worker| received shutdown message"), (c = o) == null || c.close(), process.exit(0)), r === s.searchDevices)
    try {
      const [t, i] = await Promise.all([
        Promise.resolve(n.findWLDevices()),
        n.findWLBootloaderDevices()
      ]), a = {
        type: s.result,
        hidDevices: t,
        bootloaderDevices: i
      };
      o.postMessage(a);
    } catch (t) {
      e.error("|search_devices_worker| error: " + t);
      const i = {
        type: s.error,
        error: String(t)
      };
      o.postMessage(i);
    }
});
