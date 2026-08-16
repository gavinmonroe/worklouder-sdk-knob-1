var l = Object.defineProperty;
var s = (e, n, i) => n in e ? l(e, n, { enumerable: !0, configurable: !0, writable: !0, value: i }) : e[n] = i;
var a = (e, n, i) => s(e, typeof n != "symbol" ? n + "" : n, i);
class t {
}
a(t, "commonChannelKey", "commonChannel"), a(t, "imageChannelKey", "imageChannel"), a(t, "mainWinChannelKey", "mainWinChannel"), a(t, "fsChannelKey", "fsChannel"), a(t, "devicesManagerChannelKey", "devicesManagerChannel"), a(t, "connectedDeviceChannelKey", "connectedDeviceChannel"), a(t, "updateChannelKey", "updateChannel"), a(t, "rpcChannelKey", "rpcChannel"), a(t, "localStorageChannelKey", "localStorageChannel"), a(t, "radialMenuChannelKey", "radialMenuChannel"), a(t, "cheatSheetChannelKey", "cheatSheetChannel");
var r = /* @__PURE__ */ ((e) => (e.onInitData = "cheatSheetOnInitData", e.onModeChange = "cheatSheetOnModeChange", e.reportWindowSize = "cheatSheetReportWindowSize", e.startDrag = "cheatSheetStartDrag", e.stopDrag = "cheatSheetStopDrag", e))(r || {});
const { contextBridge: h, ipcRenderer: o, IpcRendererEvent: D } = require("electron"), g = {
  platform: process.platform,
  onInitData(e) {
    const n = (i, c) => {
      e(c);
    };
    return o.on(r.onInitData, n), () => {
      o.removeListener(r.onInitData, n);
    };
  },
  onModeChange(e) {
    const n = (i, c) => {
      e(c);
    };
    return o.on(r.onModeChange, n), () => {
      o.removeListener(r.onModeChange, n);
    };
  },
  reportWindowSize(e, n) {
    o.invoke(r.reportWindowSize, e, n);
  },
  startDrag() {
    o.send(r.startDrag);
  },
  stopDrag() {
    o.send(r.stopDrag);
  }
};
h.exposeInMainWorld(t.cheatSheetChannelKey, g);
