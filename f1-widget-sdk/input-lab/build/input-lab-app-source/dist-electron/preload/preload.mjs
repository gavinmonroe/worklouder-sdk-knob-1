var w = Object.defineProperty;
var S = (e, t, i) => t in e ? w(e, t, { enumerable: !0, configurable: !0, writable: !0, value: i }) : e[t] = i;
var g = (e, t, i) => S(e, typeof t != "symbol" ? t + "" : t, i);
var c = /* @__PURE__ */ ((e) => (e.appVersion = "app-version", e.mainLog = "main-log", e.openDevTools = "open-dev-tools", e.enableMenuShortcuts = "enable-menu-shortcuts", e.disableMenuShortcuts = "disable-menu-shortcuts", e.openMacSettings = "open-mac-settings", e.openExternalTab = "open-external-tab", e.openFilePicker = "open-file-picker", e.getIsDevToolsOpen = "is-dev-tools-open", e.startFocusDetect = "start-focus-detect", e.sendAnalytics = "common-send-analytics", e.getAppSettings = "common-get-app-settings", e.sendAppSettings = "common-send-app-settings", e.onShortcutTriggered = "common-on-shortcut-triggered", e.checkAppPermissions = "common-check-app-permissions", e))(c || {}), p = /* @__PURE__ */ ((e) => (e.imageToLvgl = "image-channel-to-lvgl", e.lvglToImage = "image-channel-from-lvgl", e.accentFromImage = "image-channel-accent-from-image", e.getWallpaperImage = "image-channel-get-wallpaper-image", e.getGifFrameCount = "image-channel-get-gif-frame-count", e.cropGifImage = "image-channel-crop-gif", e))(p || {}), s = /* @__PURE__ */ ((e) => (e.getDevices = "devsManGetDevs", e.searchDevices = "devsManSearchDevs", e.getBootloaderDevices = "devsManGetBootloaderDevs", e.onDevicesFound = "devsManOnDevicesFound", e.getLatestFwRelease = "devsManGetLatestFwRelease", e.onBootloaderDevicesFound = "devsManOnBlDevicesFound", e.onFlashingProgress = "devsManOnFlashingProgress", e.onFlashingLog = "devsManOnFlashingLog", e.flashFw = "devsManFlashFw", e))(s || {}), k = /* @__PURE__ */ ((e) => (e.checkUpdates = "check-updates", e.installUpdate = "install-update", e.onUpdateDownloaded = "on-update-downloaded", e))(k || {});
class a {
}
g(a, "commonChannelKey", "commonChannel"), g(a, "imageChannelKey", "imageChannel"), g(a, "mainWinChannelKey", "mainWinChannel"), g(a, "fsChannelKey", "fsChannel"), g(a, "devicesManagerChannelKey", "devicesManagerChannel"), g(a, "connectedDeviceChannelKey", "connectedDeviceChannel"), g(a, "updateChannelKey", "updateChannel"), g(a, "rpcChannelKey", "rpcChannel"), g(a, "localStorageChannelKey", "localStorageChannel"), g(a, "radialMenuChannelKey", "radialMenuChannel"), g(a, "cheatSheetChannelKey", "cheatSheetChannel");
var o = /* @__PURE__ */ ((e) => (e.isConnected = "isConnected", e.getFileFetchStatus = "connDeviceGetFileFetchStatus", e.changeDeviceConfig = "connDeviceChangeDeviceConfig", e.onChangeDeviceConfig = "connDeviceOnChangeDeviceConfig", e.connect = "connect", e.disconnect = "disconnect", e.getConnectedDevice = "getConnectedDevice", e.sendLegacyRpcCall = "sendLegacyRpcCall", e.sendJsonRpcCall = "sendJsonRpcCall", e.onConnectionEvent = "onConnectionEvent", e.onFileFetchEvent = "connDeviceOnFileFetchEvent", e.deleteWallpaper = "connDeviceDeleteWallpaper", e.addWallpaper = "connDeviceAddWallpaper", e.clearCache = "connDeviceClearCache", e.abortRpcCall = "connDeviceAbortRpcCall", e.getFwUpdateInfo = "connDeviceGetFwUpdateInfo", e.getLatestFwRelease = "connDeviceGetLatestFwRelease", e))(o || {}), v = /* @__PURE__ */ ((e) => (e.downloadFile = "downloadFile", e.deleteFile = "deleteFile", e.saveBackupFile = "saveBackupFile", e.getBackupFiles = "getBackupFiles", e.deleteBackupFiles = "deleteBackupFiles", e.readFile = "readFile", e.selectApplication = "fsChannelSelectApplication", e.getApplications = "fsChannelGetApplications", e.openApplication = "fsChannelOpenApplication", e))(v || {}), l = /* @__PURE__ */ ((e) => (e.getFirmwareVersion = "rpcGetFirmwareVersion", e.getDeviceStatus = "rpcGetDeviceStatus", e.getFirmwareVersionLegacy = "rpcGetFirmwareVersionLegacy", e.sentIntoBootloader = "rpcSentIntoBootloader", e.sentIntoBootloaderLegacy = "rpcSentIntoBootloaderLegacy", e.sendIntoSelfTest = "rpcSendIntoSelfTest", e.sendIntoSelfTestLegacy = "rpcSendIntoSelfTestLegacy", e.getFileList = "rpcGetFileList", e.readFile = "rpcReadFile", e.writeFile = "rpcWriteFile", e.writeFileChunked = "rpcWriteFileChunked", e.readFileChunked = "rpcreadFileChunked", e.deleteFile = "rpcDeleteFile", e.sendHomeAccentColor = "rpcSentHomeAccentColor", e.sendLightingPreview = "rpcSendLightingPreview", e.fetchDeviceData = "rpcFetchDeviceData", e.fetchWallpaper = "rpcFetchWallpaper", e))(l || {}), F = /* @__PURE__ */ ((e) => (e.getDeviceConfig = "localStorageGetDeviceConfig", e.saveDeviceConfig = "localStorageSaveDeviceConfig", e.getPresets = "localStorageGetPresets", e.savePreset = "localStorageSavePreset", e.getShownMigrations = "localStorageGetShownMigrations", e.markMigrationShown = "localStorageMarkMigrationShown", e))(F || {});
const { contextBridge: u, ipcRenderer: n, IpcRendererEvent: A } = require("electron"), L = {
  platform: process.platform,
  appVersion: () => n.invoke(c.appVersion),
  onMainLog(e) {
    const t = (i, r) => e(r);
    return n.on(c.mainLog, t), () => {
      n.removeListener(c.mainLog, t);
    };
  },
  openDevTools() {
    return n.invoke(c.openDevTools);
  },
  enableMenuShortcuts() {
    return n.invoke(c.enableMenuShortcuts);
  },
  disableMenuShortcuts() {
    return n.invoke(c.disableMenuShortcuts);
  },
  openMacSettings() {
    return n.invoke(c.openMacSettings);
  },
  openExternalTab(e) {
    return n.invoke(c.openExternalTab, e);
  },
  openFilePicker() {
    return n.invoke(c.openFilePicker);
  },
  getIsDevToolsOpen() {
    return n.invoke(c.getIsDevToolsOpen);
  },
  startFocusDetect() {
    return n.invoke(c.startFocusDetect);
  },
  sendAnalytics(e) {
    return n.invoke(c.sendAnalytics, e);
  },
  getAppSettings() {
    return n.invoke(c.getAppSettings);
  },
  saveAppSettings(e) {
    return n.invoke(c.sendAppSettings, e);
  },
  onShortcutTriggered(e) {
    const t = (i, r) => e(r[0]);
    return n.on(c.onShortcutTriggered, t), () => {
      n.removeListener(c.onShortcutTriggered, t);
    };
  },
  checkAppPermissions(e) {
    return n.invoke(c.checkAppPermissions, e);
  }
}, y = {
  convertImageToLvglFormat(e) {
    return n.invoke(p.imageToLvgl, e);
  },
  convertImageFromLvglFormat(e) {
    return n.invoke(p.lvglToImage, e);
  },
  getAccentColorFromImage(e) {
    return n.invoke(p.accentFromImage, e);
  },
  getWallpaperImage(e, t) {
    return n.invoke(
      p.getWallpaperImage,
      e,
      t
    );
  },
  getGifFrameCount(e) {
    return n.invoke(p.getGifFrameCount, e);
  },
  cropGifImage(e, t, i, r, d, m, f, D) {
    return n.invoke(
      p.cropGifImage,
      e,
      t,
      i,
      r,
      d,
      m,
      f,
      D
    );
  }
}, I = {
  downloadFile(e) {
    return n.invoke(v.downloadFile, e);
  },
  deleteFile(e) {
    return n.invoke(v.deleteFile, e);
  },
  saveBackupFile(e, t) {
    return n.invoke(v.saveBackupFile, e, t);
  },
  getBackupFiles() {
    return n.invoke(v.getBackupFiles);
  },
  deleteBackupFiles() {
    return n.invoke(v.deleteBackupFiles);
  },
  readBinaryFile(e) {
    return n.invoke(v.readFile, e);
  },
  getApplications() {
    return n.invoke(v.getApplications);
  },
  openApplication(e) {
    return n.invoke(v.openApplication, e);
  }
}, B = {
  async searchDevices() {
    return n.invoke(s.searchDevices);
  },
  getDevices() {
    return n.invoke(s.getDevices);
  },
  getBootloaderDevices() {
    return n.invoke(s.getBootloaderDevices);
  },
  onDevicesFound(e) {
    const t = (i, r) => e(r.length < 0 ? [] : r[0]);
    return n.on(s.onDevicesFound, t), () => {
      n.removeListener(s.onDevicesFound, t);
    };
  },
  onBootloaderDevicesFound(e) {
    const t = (i, r) => e(r.length < 0 ? [] : r[0]);
    return n.on(s.onBootloaderDevicesFound, t), () => {
      n.removeListener(s.onBootloaderDevicesFound, t);
    };
  },
  getLatestFwRelease(e) {
    return n.invoke(s.getLatestFwRelease, e);
  },
  onFlashingProgress(e) {
    const t = (i, r) => e(r[0], r[1]);
    return n.on(s.onFlashingProgress, t), () => {
      n.removeListener(s.onFlashingProgress, t);
    };
  },
  onFlashingLog(e) {
    const t = (i, r) => e(r[0]);
    return n.on(s.onFlashingLog, t), () => {
      n.removeListener(s.onFlashingLog, t);
    };
  },
  flashFirmware(e, t) {
    return n.invoke(s.flashFw, e, t);
  }
}, W = {
  async isConnected(e) {
    return n.invoke(o.isConnected, e);
  },
  getFileFetchStatus(e, t) {
    return n.invoke(o.getFileFetchStatus, e, t);
  },
  async getConnectedDevice(e) {
    return n.invoke(o.getConnectedDevice, e);
  },
  async connect(e) {
    return n.invoke(o.connect, e);
  },
  disconnect(e) {
    return n.invoke(o.disconnect, e);
  },
  onConnectionEvents(e) {
    const t = (i, r) => e(r[0][0], r[0][1]);
    return n.on(o.onConnectionEvent, t), () => {
      n.removeListener(o.onConnectionEvent, t);
    };
  },
  onFileFetchEvents(e) {
    const t = (i, r) => e(r[0][0], r[0][1], r[0][2]);
    return n.on(o.onFileFetchEvent, t), () => {
      n.removeListener(o.onFileFetchEvent, t);
    };
  },
  changeDeviceConfig(e, t) {
    return n.invoke(o.changeDeviceConfig, e, t);
  },
  onChangeDeviceConfigResult(e) {
    const t = (i, r) => e(r[0][0], r[0][1]);
    return n.on(o.onChangeDeviceConfig, t), () => {
      n.removeListener(o.onChangeDeviceConfig, t);
    };
  },
  abortRpcCall(e, t) {
    return n.invoke(o.abortRpcCall, e, t);
  },
  clearCache(e) {
    return n.invoke(o.clearCache, e);
  },
  deleteWallpaper(e) {
    return n.invoke(o.deleteWallpaper, e);
  },
  addWallpaper(e, t, i) {
    return n.invoke(o.addWallpaper, e, t, i);
  },
  getFwUpdateInfo(e) {
    return n.invoke(o.getFwUpdateInfo, e);
  },
  getLatestFwRelease(e, t) {
    return n.invoke(o.getLatestFwRelease, e, t);
  }
}, T = {
  async checkUpdates() {
    return n.invoke(k.checkUpdates);
  },
  async instalUpdates() {
    return n.invoke(k.installUpdate);
  },
  onUpdateDownloaded(e) {
    const t = (i, r) => e(r);
    return n.on(k.onUpdateDownloaded, t), () => {
      n.removeListener(k.onUpdateDownloaded, t);
    };
  }
}, P = {
  getFirmwareVersion(e) {
    return n.invoke(l.getFirmwareVersion, e);
  },
  getDeviceStatus(e) {
    return n.invoke(l.getDeviceStatus, e);
  },
  getFirmwareVersionLegacy(e) {
    return n.invoke(l.getFirmwareVersionLegacy, e);
  },
  sendIntoBootloader(e) {
    return n.invoke(l.sentIntoBootloader, e);
  },
  sentIntoBootloaderLegacy(e) {
    return n.invoke(l.sentIntoBootloaderLegacy, e);
  },
  sendIntoSelfTest(e) {
    return n.invoke(l.sendIntoSelfTest, e);
  },
  sendIntoSelfTestLegacy(e) {
    return n.invoke(l.sendIntoSelfTestLegacy, e);
  },
  getFileList(e) {
    return n.invoke(l.getFileList, e);
  },
  readFile(e, t) {
    return n.invoke(l.readFile, e, t);
  },
  writeFile(e, t, i) {
    return n.invoke(l.writeFile, e, t, i);
  },
  writeFileChunked(e, t, i) {
    return n.invoke(l.writeFileChunked, e, t, i);
  },
  readFileChunked(e, t) {
    return n.invoke(l.readFileChunked, e, t);
  },
  deleteFile(e, t) {
    return n.invoke(l.deleteFile, e, t);
  },
  sendHomeAccentColor(e, t) {
    return n.invoke(l.sendHomeAccentColor, e, t);
  },
  sendLightingPreview(e, t) {
    return n.invoke(l.sendLightingPreview, e, t);
  },
  fetchDeviceData(e) {
    return n.invoke(l.fetchDeviceData, e);
  },
  fetchWallpaper(e) {
    return n.invoke(l.fetchWallpaper, e);
  }
}, b = {
  getDeviceConfig(e) {
    return n.invoke(F.getDeviceConfig, e);
  },
  saveDeviceConfig(e, t) {
    return n.invoke(F.saveDeviceConfig, e, t);
  },
  getPresets() {
    return n.invoke(F.getPresets);
  },
  savePreset(e) {
    return n.invoke(F.savePreset, e);
  },
  getShownMigrations() {
    return n.invoke(F.getShownMigrations);
  },
  markMigrationShown(e) {
    return n.invoke(F.markMigrationShown, e);
  }
};
u.exposeInMainWorld(a.devicesManagerChannelKey, B);
u.exposeInMainWorld(a.fsChannelKey, I);
u.exposeInMainWorld(a.connectedDeviceChannelKey, W);
u.exposeInMainWorld(a.commonChannelKey, L);
u.exposeInMainWorld(a.imageChannelKey, y);
u.exposeInMainWorld(a.updateChannelKey, T);
u.exposeInMainWorld(a.rpcChannelKey, P);
u.exposeInMainWorld(a.localStorageChannelKey, b);
