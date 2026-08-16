var s = Object.defineProperty;
var l = (e, n, i) => n in e ? s(e, n, { enumerable: !0, configurable: !0, writable: !0, value: i }) : e[n] = i;
var t = (e, n, i) => l(e, typeof n != "symbol" ? n + "" : n, i);
class a {
}
t(a, "commonChannelKey", "commonChannel"), t(a, "imageChannelKey", "imageChannel"), t(a, "mainWinChannelKey", "mainWinChannel"), t(a, "fsChannelKey", "fsChannel"), t(a, "devicesManagerChannelKey", "devicesManagerChannel"), t(a, "connectedDeviceChannelKey", "connectedDeviceChannel"), t(a, "updateChannelKey", "updateChannel"), t(a, "rpcChannelKey", "rpcChannel"), t(a, "localStorageChannelKey", "localStorageChannel"), t(a, "radialMenuChannelKey", "radialMenuChannel"), t(a, "cheatSheetChannelKey", "cheatSheetChannel");
var o = /* @__PURE__ */ ((e) => (e.onInitData = "radialMenuOnInitData", e.onMouseMove = "radialMenuOnMouseMove", e.onJoystickMove = "radialMenuOnJoystickMove", e.onHide = "radialMenuOnHide", e))(o || {});
const { contextBridge: v, ipcRenderer: r, IpcRendererEvent: d } = require("electron"), M = {
  platform: process.platform,
  onInitData(e) {
    const n = (i, c) => {
      e(c);
    };
    return r.on(o.onInitData, n), () => {
      r.removeListener(o.onInitData, n);
    };
  },
  onMouseMove(e) {
    const n = (i, c) => {
      e(c);
    };
    return r.on(o.onMouseMove, n), () => {
      r.removeListener(o.onMouseMove, n);
    };
  },
  onJoystickMove(e) {
    const n = (i, c) => {
      e(c);
    };
    return r.on(o.onJoystickMove, n), () => {
      r.removeListener(o.onJoystickMove, n);
    };
  },
  onHide(e) {
    const n = (i) => {
      e();
    };
    return r.on(o.onHide, n), () => {
      r.removeListener(o.onHide, n);
    };
  }
};
v.exposeInMainWorld(a.radialMenuChannelKey, M);
