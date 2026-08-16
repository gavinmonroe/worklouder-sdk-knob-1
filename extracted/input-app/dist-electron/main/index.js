var Xn = Object.defineProperty;
var Yn = (o, e, t) =>
  e in o
    ? Xn(o, e, { enumerable: !0, configurable: !0, writable: !0, value: t })
    : (o[e] = t);
var v = (o, e, t) => Yn(o, typeof e != "symbol" ? e + "" : e, t);
import {
  ipcMain as N,
  app as z,
  BrowserWindow as Ve,
  dialog as wr,
  shell as lt,
  Menu as Fe,
  screen as be,
  nativeTheme as Ai,
  Tray as qn,
  Notification as Zn,
  clipboard as qe,
  powerMonitor as Qn,
} from "electron";
import Mi, { release as es } from "node:os";
import Ct, { join as ue, dirname as ts } from "node:path";
import { fileURLToPath as rs } from "node:url";
import p from "electron-log";
import { Jimp as Cr } from "jimp";
import is from "https";
import {
  ConnectionEventType as Le,
  WLPermissions as os,
  convertImageToLvgl as ns,
  convertLvglToImage as ss,
  WLDeviceCommImpl as as,
  WLRPCApi as Pi,
  DeviceType as U,
  DeviceLayoutType as Ne,
  WLRelease as Ri,
  WLDeviceProgrammer as cs,
} from "@worklouder/wl-device-kit";
import Li from "node:fs/promises";
import { download as ls, CancelError as ds } from "electron-dl";
import { exec as ps } from "child_process";
import hs from "electron-updater";
import { GifUtil as Sr, GifCodec as us, GifFrame as St } from "gifwrap";
import $i, {
  join as fe,
  dirname as xi,
  relative as fs,
  sep as kr,
  resolve as Wi,
} from "path";
import { Worker as ms } from "worker_threads";
import vs from "lokijs";
import { spawn as ji, execFile as Ui, exec as Er } from "node:child_process";
import * as te from "fs";
import gs, { existsSync as ys } from "fs";
import * as _s from "crypto";
import Dr, { randomUUID as ws } from "crypto";
import { isDeepStrictEqual as Cs } from "node:util";
import Ss from "os";
var Z = ((o) => (
  (o[(o.mediaPlayer = 0)] = "mediaPlayer"),
  (o[(o.alert = 1)] = "alert"),
  (o[(o.radialMenu = 2)] = "radialMenu"),
  (o[(o.focusedApp = 3)] = "focusedApp"),
  (o[(o.wallpaper = 4)] = "wallpaper"),
  o
))(Z || {});
class ks {
  constructor() {
    v(this, "isFetchingData");
    v(this, "lastFetchedMediaData");
    this.isFetchingData = !1;
  }
  get isFetching() {
    return this.isFetchingData;
  }
  stopMediaFetching() {
    (p.info("Stopping media fetching"),
      (this.isFetchingData = !1),
      (this.lastFetchedMediaData = void 0));
  }
  stopMediaFetchingForDevice(e) {
    p.info("|media_player_service| stopping media fetching for device");
    const t = m.get().devicesCommManager,
      r = t.getDevice(e);
    r &&
      (t.setDeviceFeature(r.id, Z.mediaPlayer, !1),
      m
        .get()
        .devicesCommManager.getDevices()
        .filter((i) => i.features.get(Z.mediaPlayer)).length <= 0 &&
        (p.info("|media_player_service| no device needs media"),
        this.stopMediaFetching()));
  }
  startMediaFetching() {
    if (!this.isFetchingData) {
      (p.info("Started media fetching"), (this.isFetchingData = !0));
      try {
        this.fetchMediaData();
      } catch (e) {
        p.error(e);
      }
    }
  }
  async fetchMediaData() {
    if (!this.isFetchingData) {
      p.info("Stopping fetching media data");
      return;
    }
    const e = this.getActiveMediaDevices();
    if (e.length === 0) {
      (p.info("No device that uses media is connected, stopping fetching"),
        this.stopMediaFetching());
      return;
    }
    (await this.sendMediaToDevices(e),
      setTimeout(() => this.fetchMediaData(), 1e3));
  }
  getActiveMediaDevices() {
    return m
      .get()
      .devicesCommManager.getDevices()
      .filter((e) =>
        e.isConnected() ? (e.features.get(Z.mediaPlayer) ?? !1) : !1,
      );
  }
  async sendMediaToDevices(e) {
    var t;
    try {
      p.info("|media_player_service| fetching media player data");
      let r = await m.get().nativeService.getMediaPlayerInfo();
      if (r === void 0) {
        if (this.lastFetchedMediaData === void 0) {
          p.info("|media_player_service| no media found playing");
          return;
        }
        (p.info(
          "|media_player_service| new media is undefined, player has stopped playing",
        ),
          (this.lastFetchedMediaData.isPlaying = !1),
          e.forEach((n) => {
            n.rpcService.sendMediaInfo({ isPlaying: !1 });
          }));
        return;
      }
      if (
        (p.info("Sending basic media player info to device"),
        e.forEach(async (n) => {
          if (!(await this.sendInfoDiff(n, r))) {
            (p.error(
              "|media_player_service| there has been an error while sending media info data to device. Stopping",
            ),
              m
                .get()
                .devicesCommManager.setDeviceFeature(n.id, Z.mediaPlayer, !1));
            return;
          }
        }),
        ((t = this.lastFetchedMediaData) == null ? void 0 : t.trackName) ==
          r.trackName)
      ) {
        this.lastFetchedMediaData = r;
        return;
      }
      p.info("|media_player_service| Getting media player art");
      const i = await this.getMediaPlayerArtwork(r);
      (i !== void 0 &&
        e.forEach(async (n) => {
          (p.info("|media_player_service| Sending artwork data to device"),
            await n.rpcService.writeMediaArtWork(i));
        }),
        (this.lastFetchedMediaData = r));
    } catch (r) {
      p.error(r);
    }
  }
  sendInfoDiff(e, t) {
    var r, i, n, s, l;
    return e.rpcService.sendMediaInfo({
      song_title:
        t.trackName !==
        ((r = this.lastFetchedMediaData) == null ? void 0 : r.trackName)
          ? t.trackName
          : void 0,
      duration:
        t.duration !==
        ((i = this.lastFetchedMediaData) == null ? void 0 : i.duration)
          ? t.duration
          : void 0,
      artist:
        t.artist !==
        ((n = this.lastFetchedMediaData) == null ? void 0 : n.artist)
          ? t.artist
          : void 0,
      elapsed:
        t.elapsed !==
        ((s = this.lastFetchedMediaData) == null ? void 0 : s.elapsed)
          ? t.elapsed
          : void 0,
      isPlaying:
        t.isPlaying ??
        ((l = this.lastFetchedMediaData) == null ? void 0 : l.isPlaying),
    });
  }
  escapeUTF8(e) {
    const t = new TextEncoder().encode(e);
    let r = "";
    for (let i of t)
      i >= 32 && i <= 126
        ? (r += String.fromCharCode(i))
        : (r += "\\x" + i.toString(16).padStart(2, "0"));
    return r;
  }
  async getMediaPlayerArtwork(e) {
    p.info("Fetching media artwork");
    let t;
    if (e.artworkUrl !== void 0)
      (p.info("Found image url, downloading it"),
        (t = await this.downloadArtwork(e.artworkUrl)));
    else if (e.artworkData !== void 0)
      (p.info("Found image data, using it"),
        (t = Buffer.from(e.artworkData, "base64")),
        p.info("Converted from base64"));
    else {
      p.info("No image found, continuing without it");
      return;
    }
    try {
      const r = await Cr.read(t);
      r.resize({ w: 80, h: 80 });
      const i = await r.getBuffer("image/png"),
        n = new Uint8Array(i);
      return m.get().imageService.convertToLvglFormat(n);
    } catch (r) {
      p.error(r);
      return;
    }
  }
  async downloadArtwork(e) {
    return new Promise((t, r) => {
      const i = is.get(e, (n) => {
        const s = [];
        (n.on("data", (l) => s.push(l)),
          n.on("end", () => {
            const l = Buffer.concat(s);
            t(l);
          }),
          n.on("error", (l) => r(l)));
      });
      (i.on("error", (n) => r(n)),
        i.setTimeout(1e4, () => {
          i.destroy(new Error("Request timed out"));
        }));
    });
  }
  onNotifyReceived(e, t) {
    p.info("Media player notify received");
    const r = t.should_fetch;
    if (typeof r != "boolean") {
      p.error("Params are not of boolean type");
      return;
    }
    if (r) {
      const i = m.get().devicesCommManager.getDevice(e);
      if (i) {
        (m.get().devicesCommManager.setDeviceFeature(i.id, Z.mediaPlayer, r),
          this.startMediaFetching());
        return;
      }
    }
    this.stopMediaFetching();
  }
  replaceNonAsciiWithSymbol(e, t = "*") {
    return e.replace(/[^\x00-\x7F]/g, t);
  }
}
var we = ((o) => (
  (o.isConnected = "isConnected"),
  (o.getFileFetchStatus = "connDeviceGetFileFetchStatus"),
  (o.changeDeviceConfig = "connDeviceChangeDeviceConfig"),
  (o.onChangeDeviceConfig = "connDeviceOnChangeDeviceConfig"),
  (o.connect = "connect"),
  (o.disconnect = "disconnect"),
  (o.getConnectedDevice = "getConnectedDevice"),
  (o.sendLegacyRpcCall = "sendLegacyRpcCall"),
  (o.sendJsonRpcCall = "sendJsonRpcCall"),
  (o.onConnectionEvent = "onConnectionEvent"),
  (o.onFileFetchEvent = "connDeviceOnFileFetchEvent"),
  (o.deleteWallpaper = "connDeviceDeleteWallpaper"),
  (o.addWallpaper = "connDeviceAddWallpaper"),
  (o.clearCache = "connDeviceClearCache"),
  (o.abortRpcCall = "connDeviceAbortRpcCall"),
  (o.getFwUpdateInfo = "connDeviceGetFwUpdateInfo"),
  (o.getLatestFwRelease = "connDeviceGetLatestFwRelease"),
  o
))(we || {});
function Vi(o) {
  return o && o.__esModule && Object.prototype.hasOwnProperty.call(o, "default")
    ? o.default
    : o;
}
var V = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var Bi;
function Es() {
  if (Bi) return V;
  Bi = 1;
  var o = Symbol.for("react.element"),
    e = Symbol.for("react.portal"),
    t = Symbol.for("react.fragment"),
    r = Symbol.for("react.strict_mode"),
    i = Symbol.for("react.profiler"),
    n = Symbol.for("react.provider"),
    s = Symbol.for("react.context"),
    l = Symbol.for("react.forward_ref"),
    c = Symbol.for("react.suspense"),
    h = Symbol.for("react.memo"),
    d = Symbol.for("react.lazy"),
    f = Symbol.iterator;
  function _(g) {
    return g === null || typeof g != "object"
      ? null
      : ((g = (f && g[f]) || g["@@iterator"]),
        typeof g == "function" ? g : null);
  }
  var C = {
      isMounted: function () {
        return !1;
      },
      enqueueForceUpdate: function () {},
      enqueueReplaceState: function () {},
      enqueueSetState: function () {},
    },
    O = Object.assign,
    T = {};
  function W(g, S, F) {
    ((this.props = g),
      (this.context = S),
      (this.refs = T),
      (this.updater = F || C));
  }
  ((W.prototype.isReactComponent = {}),
    (W.prototype.setState = function (g, S) {
      if (typeof g != "object" && typeof g != "function" && g != null)
        throw Error(
          "setState(...): takes an object of state variables to update or a function which returns an object of state variables.",
        );
      this.updater.enqueueSetState(this, g, S, "setState");
    }),
    (W.prototype.forceUpdate = function (g) {
      this.updater.enqueueForceUpdate(this, g, "forceUpdate");
    }));
  function b() {}
  b.prototype = W.prototype;
  function H(g, S, F) {
    ((this.props = g),
      (this.context = S),
      (this.refs = T),
      (this.updater = F || C));
  }
  var G = (H.prototype = new b());
  ((G.constructor = H), O(G, W.prototype), (G.isPureReactComponent = !0));
  var oe = Array.isArray,
    ne = Object.prototype.hasOwnProperty,
    ge = { current: null },
    de = { key: !0, ref: !0, __self: !0, __source: !0 };
  function Ce(g, S, F) {
    var M,
      B = {},
      Y = null,
      se = null;
    if (S != null)
      for (M in (S.ref !== void 0 && (se = S.ref),
      S.key !== void 0 && (Y = "" + S.key),
      S))
        ne.call(S, M) && !de.hasOwnProperty(M) && (B[M] = S[M]);
    var ae = arguments.length - 2;
    if (ae === 1) B.children = F;
    else if (1 < ae) {
      for (var ee = Array(ae), Se = 0; Se < ae; Se++)
        ee[Se] = arguments[Se + 2];
      B.children = ee;
    }
    if (g && g.defaultProps)
      for (M in ((ae = g.defaultProps), ae)) B[M] === void 0 && (B[M] = ae[M]);
    return {
      $$typeof: o,
      type: g,
      key: Y,
      ref: se,
      props: B,
      _owner: ge.current,
    };
  }
  function ot(g, S) {
    return {
      $$typeof: o,
      type: g.type,
      key: S,
      ref: g.ref,
      props: g.props,
      _owner: g._owner,
    };
  }
  function Xe(g) {
    return typeof g == "object" && g !== null && g.$$typeof === o;
  }
  function gt(g) {
    var S = { "=": "=0", ":": "=2" };
    return (
      "$" +
      g.replace(/[=:]/g, function (F) {
        return S[F];
      })
    );
  }
  var nt = /\/+/g;
  function Ye(g, S) {
    return typeof g == "object" && g !== null && g.key != null
      ? gt("" + g.key)
      : S.toString(36);
  }
  function I(g, S, F, M, B) {
    var Y = typeof g;
    (Y === "undefined" || Y === "boolean") && (g = null);
    var se = !1;
    if (g === null) se = !0;
    else
      switch (Y) {
        case "string":
        case "number":
          se = !0;
          break;
        case "object":
          switch (g.$$typeof) {
            case o:
            case e:
              se = !0;
          }
      }
    if (se)
      return (
        (se = g),
        (B = B(se)),
        (g = M === "" ? "." + Ye(se, 0) : M),
        oe(B)
          ? ((F = ""),
            g != null && (F = g.replace(nt, "$&/") + "/"),
            I(B, S, F, "", function (Se) {
              return Se;
            }))
          : B != null &&
            (Xe(B) &&
              (B = ot(
                B,
                F +
                  (!B.key || (se && se.key === B.key)
                    ? ""
                    : ("" + B.key).replace(nt, "$&/") + "/") +
                  g,
              )),
            S.push(B)),
        1
      );
    if (((se = 0), (M = M === "" ? "." : M + ":"), oe(g)))
      for (var ae = 0; ae < g.length; ae++) {
        Y = g[ae];
        var ee = M + Ye(Y, ae);
        se += I(Y, S, F, ee, B);
      }
    else if (((ee = _(g)), typeof ee == "function"))
      for (g = ee.call(g), ae = 0; !(Y = g.next()).done; )
        ((Y = Y.value), (ee = M + Ye(Y, ae++)), (se += I(Y, S, F, ee, B)));
    else if (Y === "object")
      throw (
        (S = String(g)),
        Error(
          "Objects are not valid as a React child (found: " +
            (S === "[object Object]"
              ? "object with keys {" + Object.keys(g).join(", ") + "}"
              : S) +
            "). If you meant to render a collection of children, use an array instead.",
        )
      );
    return se;
  }
  function E(g, S, F) {
    if (g == null) return g;
    var M = [],
      B = 0;
    return (
      I(g, M, "", "", function (Y) {
        return S.call(F, Y, B++);
      }),
      M
    );
  }
  function A(g) {
    if (g._status === -1) {
      var S = g._result;
      ((S = S()),
        S.then(
          function (F) {
            (g._status === 0 || g._status === -1) &&
              ((g._status = 1), (g._result = F));
          },
          function (F) {
            (g._status === 0 || g._status === -1) &&
              ((g._status = 2), (g._result = F));
          },
        ),
        g._status === -1 && ((g._status = 0), (g._result = S)));
    }
    if (g._status === 1) return g._result.default;
    throw g._result;
  }
  var k = { current: null },
    R = { transition: null },
    P = {
      ReactCurrentDispatcher: k,
      ReactCurrentBatchConfig: R,
      ReactCurrentOwner: ge,
    };
  function $() {
    throw Error("act(...) is not supported in production builds of React.");
  }
  return (
    (V.Children = {
      map: E,
      forEach: function (g, S, F) {
        E(
          g,
          function () {
            S.apply(this, arguments);
          },
          F,
        );
      },
      count: function (g) {
        var S = 0;
        return (
          E(g, function () {
            S++;
          }),
          S
        );
      },
      toArray: function (g) {
        return (
          E(g, function (S) {
            return S;
          }) || []
        );
      },
      only: function (g) {
        if (!Xe(g))
          throw Error(
            "React.Children.only expected to receive a single React element child.",
          );
        return g;
      },
    }),
    (V.Component = W),
    (V.Fragment = t),
    (V.Profiler = i),
    (V.PureComponent = H),
    (V.StrictMode = r),
    (V.Suspense = c),
    (V.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = P),
    (V.act = $),
    (V.cloneElement = function (g, S, F) {
      if (g == null)
        throw Error(
          "React.cloneElement(...): The argument must be a React element, but you passed " +
            g +
            ".",
        );
      var M = O({}, g.props),
        B = g.key,
        Y = g.ref,
        se = g._owner;
      if (S != null) {
        if (
          (S.ref !== void 0 && ((Y = S.ref), (se = ge.current)),
          S.key !== void 0 && (B = "" + S.key),
          g.type && g.type.defaultProps)
        )
          var ae = g.type.defaultProps;
        for (ee in S)
          ne.call(S, ee) &&
            !de.hasOwnProperty(ee) &&
            (M[ee] = S[ee] === void 0 && ae !== void 0 ? ae[ee] : S[ee]);
      }
      var ee = arguments.length - 2;
      if (ee === 1) M.children = F;
      else if (1 < ee) {
        ae = Array(ee);
        for (var Se = 0; Se < ee; Se++) ae[Se] = arguments[Se + 2];
        M.children = ae;
      }
      return {
        $$typeof: o,
        type: g.type,
        key: B,
        ref: Y,
        props: M,
        _owner: se,
      };
    }),
    (V.createContext = function (g) {
      return (
        (g = {
          $$typeof: s,
          _currentValue: g,
          _currentValue2: g,
          _threadCount: 0,
          Provider: null,
          Consumer: null,
          _defaultValue: null,
          _globalName: null,
        }),
        (g.Provider = { $$typeof: n, _context: g }),
        (g.Consumer = g)
      );
    }),
    (V.createElement = Ce),
    (V.createFactory = function (g) {
      var S = Ce.bind(null, g);
      return ((S.type = g), S);
    }),
    (V.createRef = function () {
      return { current: null };
    }),
    (V.forwardRef = function (g) {
      return { $$typeof: l, render: g };
    }),
    (V.isValidElement = Xe),
    (V.lazy = function (g) {
      return { $$typeof: d, _payload: { _status: -1, _result: g }, _init: A };
    }),
    (V.memo = function (g, S) {
      return { $$typeof: h, type: g, compare: S === void 0 ? null : S };
    }),
    (V.startTransition = function (g) {
      var S = R.transition;
      R.transition = {};
      try {
        g();
      } finally {
        R.transition = S;
      }
    }),
    (V.unstable_act = $),
    (V.useCallback = function (g, S) {
      return k.current.useCallback(g, S);
    }),
    (V.useContext = function (g) {
      return k.current.useContext(g);
    }),
    (V.useDebugValue = function () {}),
    (V.useDeferredValue = function (g) {
      return k.current.useDeferredValue(g);
    }),
    (V.useEffect = function (g, S) {
      return k.current.useEffect(g, S);
    }),
    (V.useId = function () {
      return k.current.useId();
    }),
    (V.useImperativeHandle = function (g, S, F) {
      return k.current.useImperativeHandle(g, S, F);
    }),
    (V.useInsertionEffect = function (g, S) {
      return k.current.useInsertionEffect(g, S);
    }),
    (V.useLayoutEffect = function (g, S) {
      return k.current.useLayoutEffect(g, S);
    }),
    (V.useMemo = function (g, S) {
      return k.current.useMemo(g, S);
    }),
    (V.useReducer = function (g, S, F) {
      return k.current.useReducer(g, S, F);
    }),
    (V.useRef = function (g) {
      return k.current.useRef(g);
    }),
    (V.useState = function (g) {
      return k.current.useState(g);
    }),
    (V.useSyncExternalStore = function (g, S, F) {
      return k.current.useSyncExternalStore(g, S, F);
    }),
    (V.useTransition = function () {
      return k.current.useTransition();
    }),
    (V.version = "18.3.1"),
    V
  );
}
var jt = { exports: {} };
jt.exports;
var Gi;
function Ds() {
  return (
    Gi ||
      ((Gi = 1),
      (function (o, e) {
        /**
         * @license React
         * react.development.js
         *
         * Copyright (c) Facebook, Inc. and its affiliates.
         *
         * This source code is licensed under the MIT license found in the
         * LICENSE file in the root directory of this source tree.
         */ process.env.NODE_ENV !== "production" &&
          (function () {
            typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" &&
              typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart ==
                "function" &&
              __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(
                new Error(),
              );
            var t = "18.3.1",
              r = Symbol.for("react.element"),
              i = Symbol.for("react.portal"),
              n = Symbol.for("react.fragment"),
              s = Symbol.for("react.strict_mode"),
              l = Symbol.for("react.profiler"),
              c = Symbol.for("react.provider"),
              h = Symbol.for("react.context"),
              d = Symbol.for("react.forward_ref"),
              f = Symbol.for("react.suspense"),
              _ = Symbol.for("react.suspense_list"),
              C = Symbol.for("react.memo"),
              O = Symbol.for("react.lazy"),
              T = Symbol.for("react.offscreen"),
              W = Symbol.iterator,
              b = "@@iterator";
            function H(a) {
              if (a === null || typeof a != "object") return null;
              var u = (W && a[W]) || a[b];
              return typeof u == "function" ? u : null;
            }
            var G = { current: null },
              oe = { transition: null },
              ne = {
                current: null,
                isBatchingLegacy: !1,
                didScheduleLegacyUpdate: !1,
              },
              ge = { current: null },
              de = {},
              Ce = null;
            function ot(a) {
              Ce = a;
            }
            ((de.setExtraStackFrame = function (a) {
              Ce = a;
            }),
              (de.getCurrentStack = null),
              (de.getStackAddendum = function () {
                var a = "";
                Ce && (a += Ce);
                var u = de.getCurrentStack;
                return (u && (a += u() || ""), a);
              }));
            var Xe = !1,
              gt = !1,
              nt = !1,
              Ye = !1,
              I = !1,
              E = {
                ReactCurrentDispatcher: G,
                ReactCurrentBatchConfig: oe,
                ReactCurrentOwner: ge,
              };
            ((E.ReactDebugCurrentFrame = de), (E.ReactCurrentActQueue = ne));
            function A(a) {
              {
                for (
                  var u = arguments.length,
                    y = new Array(u > 1 ? u - 1 : 0),
                    w = 1;
                  w < u;
                  w++
                )
                  y[w - 1] = arguments[w];
                R("warn", a, y);
              }
            }
            function k(a) {
              {
                for (
                  var u = arguments.length,
                    y = new Array(u > 1 ? u - 1 : 0),
                    w = 1;
                  w < u;
                  w++
                )
                  y[w - 1] = arguments[w];
                R("error", a, y);
              }
            }
            function R(a, u, y) {
              {
                var w = E.ReactDebugCurrentFrame,
                  D = w.getStackAddendum();
                D !== "" && ((u += "%s"), (y = y.concat([D])));
                var x = y.map(function (K) {
                  return String(K);
                });
                (x.unshift("Warning: " + u),
                  Function.prototype.apply.call(console[a], console, x));
              }
            }
            var P = {};
            function $(a, u) {
              {
                var y = a.constructor,
                  w = (y && (y.displayName || y.name)) || "ReactClass",
                  D = w + "." + u;
                if (P[D]) return;
                (k(
                  "Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.",
                  u,
                  w,
                ),
                  (P[D] = !0));
              }
            }
            var g = {
                isMounted: function (a) {
                  return !1;
                },
                enqueueForceUpdate: function (a, u, y) {
                  $(a, "forceUpdate");
                },
                enqueueReplaceState: function (a, u, y, w) {
                  $(a, "replaceState");
                },
                enqueueSetState: function (a, u, y, w) {
                  $(a, "setState");
                },
              },
              S = Object.assign,
              F = {};
            Object.freeze(F);
            function M(a, u, y) {
              ((this.props = a),
                (this.context = u),
                (this.refs = F),
                (this.updater = y || g));
            }
            ((M.prototype.isReactComponent = {}),
              (M.prototype.setState = function (a, u) {
                if (typeof a != "object" && typeof a != "function" && a != null)
                  throw new Error(
                    "setState(...): takes an object of state variables to update or a function which returns an object of state variables.",
                  );
                this.updater.enqueueSetState(this, a, u, "setState");
              }),
              (M.prototype.forceUpdate = function (a) {
                this.updater.enqueueForceUpdate(this, a, "forceUpdate");
              }));
            {
              var B = {
                  isMounted: [
                    "isMounted",
                    "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks.",
                  ],
                  replaceState: [
                    "replaceState",
                    "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236).",
                  ],
                },
                Y = function (a, u) {
                  Object.defineProperty(M.prototype, a, {
                    get: function () {
                      A(
                        "%s(...) is deprecated in plain JavaScript React classes. %s",
                        u[0],
                        u[1],
                      );
                    },
                  });
                };
              for (var se in B) B.hasOwnProperty(se) && Y(se, B[se]);
            }
            function ae() {}
            ae.prototype = M.prototype;
            function ee(a, u, y) {
              ((this.props = a),
                (this.context = u),
                (this.refs = F),
                (this.updater = y || g));
            }
            var Se = (ee.prototype = new ae());
            ((Se.constructor = ee),
              S(Se, M.prototype),
              (Se.isPureReactComponent = !0));
            function Uo() {
              var a = { current: null };
              return (Object.seal(a), a);
            }
            var Vo = Array.isArray;
            function Ot(a) {
              return Vo(a);
            }
            function Bo(a) {
              {
                var u = typeof Symbol == "function" && Symbol.toStringTag,
                  y =
                    (u && a[Symbol.toStringTag]) ||
                    a.constructor.name ||
                    "Object";
                return y;
              }
            }
            function Go(a) {
              try {
                return (Yr(a), !1);
              } catch {
                return !0;
              }
            }
            function Yr(a) {
              return "" + a;
            }
            function Kt(a) {
              if (Go(a))
                return (
                  k(
                    "The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.",
                    Bo(a),
                  ),
                  Yr(a)
                );
            }
            function Ho(a, u, y) {
              var w = a.displayName;
              if (w) return w;
              var D = u.displayName || u.name || "";
              return D !== "" ? y + "(" + D + ")" : y;
            }
            function qr(a) {
              return a.displayName || "Context";
            }
            function Ue(a) {
              if (a == null) return null;
              if (
                (typeof a.tag == "number" &&
                  k(
                    "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue.",
                  ),
                typeof a == "function")
              )
                return a.displayName || a.name || null;
              if (typeof a == "string") return a;
              switch (a) {
                case n:
                  return "Fragment";
                case i:
                  return "Portal";
                case l:
                  return "Profiler";
                case s:
                  return "StrictMode";
                case f:
                  return "Suspense";
                case _:
                  return "SuspenseList";
              }
              if (typeof a == "object")
                switch (a.$$typeof) {
                  case h:
                    var u = a;
                    return qr(u) + ".Consumer";
                  case c:
                    var y = a;
                    return qr(y._context) + ".Provider";
                  case d:
                    return Ho(a, a.render, "ForwardRef");
                  case C:
                    var w = a.displayName || null;
                    return w !== null ? w : Ue(a.type) || "Memo";
                  case O: {
                    var D = a,
                      x = D._payload,
                      K = D._init;
                    try {
                      return Ue(K(x));
                    } catch {
                      return null;
                    }
                  }
                }
              return null;
            }
            var yt = Object.prototype.hasOwnProperty,
              Zr = { key: !0, ref: !0, __self: !0, __source: !0 },
              Qr,
              ei,
              cr;
            cr = {};
            function ti(a) {
              if (yt.call(a, "ref")) {
                var u = Object.getOwnPropertyDescriptor(a, "ref").get;
                if (u && u.isReactWarning) return !1;
              }
              return a.ref !== void 0;
            }
            function ri(a) {
              if (yt.call(a, "key")) {
                var u = Object.getOwnPropertyDescriptor(a, "key").get;
                if (u && u.isReactWarning) return !1;
              }
              return a.key !== void 0;
            }
            function Jo(a, u) {
              var y = function () {
                Qr ||
                  ((Qr = !0),
                  k(
                    "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)",
                    u,
                  ));
              };
              ((y.isReactWarning = !0),
                Object.defineProperty(a, "key", { get: y, configurable: !0 }));
            }
            function zo(a, u) {
              var y = function () {
                ei ||
                  ((ei = !0),
                  k(
                    "%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)",
                    u,
                  ));
              };
              ((y.isReactWarning = !0),
                Object.defineProperty(a, "ref", { get: y, configurable: !0 }));
            }
            function Xo(a) {
              if (
                typeof a.ref == "string" &&
                ge.current &&
                a.__self &&
                ge.current.stateNode !== a.__self
              ) {
                var u = Ue(ge.current.type);
                cr[u] ||
                  (k(
                    'Component "%s" contains the string ref "%s". Support for string refs will be removed in a future major release. This case cannot be automatically converted to an arrow function. We ask you to manually fix this case by using useRef() or createRef() instead. Learn more about using refs safely here: https://reactjs.org/link/strict-mode-string-ref',
                    u,
                    a.ref,
                  ),
                  (cr[u] = !0));
              }
            }
            var lr = function (a, u, y, w, D, x, K) {
              var j = {
                $$typeof: r,
                type: a,
                key: u,
                ref: y,
                props: K,
                _owner: x,
              };
              return (
                (j._store = {}),
                Object.defineProperty(j._store, "validated", {
                  configurable: !1,
                  enumerable: !1,
                  writable: !0,
                  value: !1,
                }),
                Object.defineProperty(j, "_self", {
                  configurable: !1,
                  enumerable: !1,
                  writable: !1,
                  value: w,
                }),
                Object.defineProperty(j, "_source", {
                  configurable: !1,
                  enumerable: !1,
                  writable: !1,
                  value: D,
                }),
                Object.freeze && (Object.freeze(j.props), Object.freeze(j)),
                j
              );
            };
            function Yo(a, u, y) {
              var w,
                D = {},
                x = null,
                K = null,
                j = null,
                J = null;
              if (u != null) {
                (ti(u) && ((K = u.ref), Xo(u)),
                  ri(u) && (Kt(u.key), (x = "" + u.key)),
                  (j = u.__self === void 0 ? null : u.__self),
                  (J = u.__source === void 0 ? null : u.__source));
                for (w in u)
                  yt.call(u, w) && !Zr.hasOwnProperty(w) && (D[w] = u[w]);
              }
              var q = arguments.length - 2;
              if (q === 1) D.children = y;
              else if (q > 1) {
                for (var re = Array(q), ie = 0; ie < q; ie++)
                  re[ie] = arguments[ie + 2];
                (Object.freeze && Object.freeze(re), (D.children = re));
              }
              if (a && a.defaultProps) {
                var ce = a.defaultProps;
                for (w in ce) D[w] === void 0 && (D[w] = ce[w]);
              }
              if (x || K) {
                var pe =
                  typeof a == "function"
                    ? a.displayName || a.name || "Unknown"
                    : a;
                (x && Jo(D, pe), K && zo(D, pe));
              }
              return lr(a, x, K, j, J, ge.current, D);
            }
            function qo(a, u) {
              var y = lr(
                a.type,
                u,
                a.ref,
                a._self,
                a._source,
                a._owner,
                a.props,
              );
              return y;
            }
            function Zo(a, u, y) {
              if (a == null)
                throw new Error(
                  "React.cloneElement(...): The argument must be a React element, but you passed " +
                    a +
                    ".",
                );
              var w,
                D = S({}, a.props),
                x = a.key,
                K = a.ref,
                j = a._self,
                J = a._source,
                q = a._owner;
              if (u != null) {
                (ti(u) && ((K = u.ref), (q = ge.current)),
                  ri(u) && (Kt(u.key), (x = "" + u.key)));
                var re;
                a.type && a.type.defaultProps && (re = a.type.defaultProps);
                for (w in u)
                  yt.call(u, w) &&
                    !Zr.hasOwnProperty(w) &&
                    (u[w] === void 0 && re !== void 0
                      ? (D[w] = re[w])
                      : (D[w] = u[w]));
              }
              var ie = arguments.length - 2;
              if (ie === 1) D.children = y;
              else if (ie > 1) {
                for (var ce = Array(ie), pe = 0; pe < ie; pe++)
                  ce[pe] = arguments[pe + 2];
                D.children = ce;
              }
              return lr(a.type, x, K, j, J, q, D);
            }
            function st(a) {
              return typeof a == "object" && a !== null && a.$$typeof === r;
            }
            var ii = ".",
              Qo = ":";
            function en(a) {
              var u = /[=:]/g,
                y = { "=": "=0", ":": "=2" },
                w = a.replace(u, function (D) {
                  return y[D];
                });
              return "$" + w;
            }
            var oi = !1,
              tn = /\/+/g;
            function ni(a) {
              return a.replace(tn, "$&/");
            }
            function dr(a, u) {
              return typeof a == "object" && a !== null && a.key != null
                ? (Kt(a.key), en("" + a.key))
                : u.toString(36);
            }
            function Ft(a, u, y, w, D) {
              var x = typeof a;
              (x === "undefined" || x === "boolean") && (a = null);
              var K = !1;
              if (a === null) K = !0;
              else
                switch (x) {
                  case "string":
                  case "number":
                    K = !0;
                    break;
                  case "object":
                    switch (a.$$typeof) {
                      case r:
                      case i:
                        K = !0;
                    }
                }
              if (K) {
                var j = a,
                  J = D(j),
                  q = w === "" ? ii + dr(j, 0) : w;
                if (Ot(J)) {
                  var re = "";
                  (q != null && (re = ni(q) + "/"),
                    Ft(J, u, re, "", function (zn) {
                      return zn;
                    }));
                } else
                  J != null &&
                    (st(J) &&
                      (J.key && (!j || j.key !== J.key) && Kt(J.key),
                      (J = qo(
                        J,
                        y +
                          (J.key && (!j || j.key !== J.key)
                            ? ni("" + J.key) + "/"
                            : "") +
                          q,
                      ))),
                    u.push(J));
                return 1;
              }
              var ie,
                ce,
                pe = 0,
                _e = w === "" ? ii : w + Qo;
              if (Ot(a))
                for (var Wt = 0; Wt < a.length; Wt++)
                  ((ie = a[Wt]),
                    (ce = _e + dr(ie, Wt)),
                    (pe += Ft(ie, u, y, ce, D)));
              else {
                var _r = H(a);
                if (typeof _r == "function") {
                  var Oi = a;
                  _r === Oi.entries &&
                    (oi ||
                      A(
                        "Using Maps as children is not supported. Use an array of keyed ReactElements instead.",
                      ),
                    (oi = !0));
                  for (
                    var Hn = _r.call(Oi), Ki, Jn = 0;
                    !(Ki = Hn.next()).done;

                  )
                    ((ie = Ki.value),
                      (ce = _e + dr(ie, Jn++)),
                      (pe += Ft(ie, u, y, ce, D)));
                } else if (x === "object") {
                  var Fi = String(a);
                  throw new Error(
                    "Objects are not valid as a React child (found: " +
                      (Fi === "[object Object]"
                        ? "object with keys {" + Object.keys(a).join(", ") + "}"
                        : Fi) +
                      "). If you meant to render a collection of children, use an array instead.",
                  );
                }
              }
              return pe;
            }
            function At(a, u, y) {
              if (a == null) return a;
              var w = [],
                D = 0;
              return (
                Ft(a, w, "", "", function (x) {
                  return u.call(y, x, D++);
                }),
                w
              );
            }
            function rn(a) {
              var u = 0;
              return (
                At(a, function () {
                  u++;
                }),
                u
              );
            }
            function on(a, u, y) {
              At(
                a,
                function () {
                  u.apply(this, arguments);
                },
                y,
              );
            }
            function nn(a) {
              return (
                At(a, function (u) {
                  return u;
                }) || []
              );
            }
            function sn(a) {
              if (!st(a))
                throw new Error(
                  "React.Children.only expected to receive a single React element child.",
                );
              return a;
            }
            function an(a) {
              var u = {
                $$typeof: h,
                _currentValue: a,
                _currentValue2: a,
                _threadCount: 0,
                Provider: null,
                Consumer: null,
                _defaultValue: null,
                _globalName: null,
              };
              u.Provider = { $$typeof: c, _context: u };
              var y = !1,
                w = !1,
                D = !1;
              {
                var x = { $$typeof: h, _context: u };
                (Object.defineProperties(x, {
                  Provider: {
                    get: function () {
                      return (
                        w ||
                          ((w = !0),
                          k(
                            "Rendering <Context.Consumer.Provider> is not supported and will be removed in a future major release. Did you mean to render <Context.Provider> instead?",
                          )),
                        u.Provider
                      );
                    },
                    set: function (K) {
                      u.Provider = K;
                    },
                  },
                  _currentValue: {
                    get: function () {
                      return u._currentValue;
                    },
                    set: function (K) {
                      u._currentValue = K;
                    },
                  },
                  _currentValue2: {
                    get: function () {
                      return u._currentValue2;
                    },
                    set: function (K) {
                      u._currentValue2 = K;
                    },
                  },
                  _threadCount: {
                    get: function () {
                      return u._threadCount;
                    },
                    set: function (K) {
                      u._threadCount = K;
                    },
                  },
                  Consumer: {
                    get: function () {
                      return (
                        y ||
                          ((y = !0),
                          k(
                            "Rendering <Context.Consumer.Consumer> is not supported and will be removed in a future major release. Did you mean to render <Context.Consumer> instead?",
                          )),
                        u.Consumer
                      );
                    },
                  },
                  displayName: {
                    get: function () {
                      return u.displayName;
                    },
                    set: function (K) {
                      D ||
                        (A(
                          "Setting `displayName` on Context.Consumer has no effect. You should set it directly on the context with Context.displayName = '%s'.",
                          K,
                        ),
                        (D = !0));
                    },
                  },
                }),
                  (u.Consumer = x));
              }
              return (
                (u._currentRenderer = null),
                (u._currentRenderer2 = null),
                u
              );
            }
            var _t = -1,
              pr = 0,
              si = 1,
              cn = 2;
            function ln(a) {
              if (a._status === _t) {
                var u = a._result,
                  y = u();
                if (
                  (y.then(
                    function (x) {
                      if (a._status === pr || a._status === _t) {
                        var K = a;
                        ((K._status = si), (K._result = x));
                      }
                    },
                    function (x) {
                      if (a._status === pr || a._status === _t) {
                        var K = a;
                        ((K._status = cn), (K._result = x));
                      }
                    },
                  ),
                  a._status === _t)
                ) {
                  var w = a;
                  ((w._status = pr), (w._result = y));
                }
              }
              if (a._status === si) {
                var D = a._result;
                return (
                  D === void 0 &&
                    k(
                      `lazy: Expected the result of a dynamic import() call. Instead received: %s

Your code should look like: 
  const MyComponent = lazy(() => import('./MyComponent'))

Did you accidentally put curly braces around the import?`,
                      D,
                    ),
                  "default" in D ||
                    k(
                      `lazy: Expected the result of a dynamic import() call. Instead received: %s

Your code should look like: 
  const MyComponent = lazy(() => import('./MyComponent'))`,
                      D,
                    ),
                  D.default
                );
              } else throw a._result;
            }
            function dn(a) {
              var u = { _status: _t, _result: a },
                y = { $$typeof: O, _payload: u, _init: ln };
              {
                var w, D;
                Object.defineProperties(y, {
                  defaultProps: {
                    configurable: !0,
                    get: function () {
                      return w;
                    },
                    set: function (x) {
                      (k(
                        "React.lazy(...): It is not supported to assign `defaultProps` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.",
                      ),
                        (w = x),
                        Object.defineProperty(y, "defaultProps", {
                          enumerable: !0,
                        }));
                    },
                  },
                  propTypes: {
                    configurable: !0,
                    get: function () {
                      return D;
                    },
                    set: function (x) {
                      (k(
                        "React.lazy(...): It is not supported to assign `propTypes` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.",
                      ),
                        (D = x),
                        Object.defineProperty(y, "propTypes", {
                          enumerable: !0,
                        }));
                    },
                  },
                });
              }
              return y;
            }
            function pn(a) {
              (a != null && a.$$typeof === C
                ? k(
                    "forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...)).",
                  )
                : typeof a != "function"
                  ? k(
                      "forwardRef requires a render function but was given %s.",
                      a === null ? "null" : typeof a,
                    )
                  : a.length !== 0 &&
                    a.length !== 2 &&
                    k(
                      "forwardRef render functions accept exactly two parameters: props and ref. %s",
                      a.length === 1
                        ? "Did you forget to use the ref parameter?"
                        : "Any additional parameter will be undefined.",
                    ),
                a != null &&
                  (a.defaultProps != null || a.propTypes != null) &&
                  k(
                    "forwardRef render functions do not support propTypes or defaultProps. Did you accidentally pass a React component?",
                  ));
              var u = { $$typeof: d, render: a };
              {
                var y;
                Object.defineProperty(u, "displayName", {
                  enumerable: !1,
                  configurable: !0,
                  get: function () {
                    return y;
                  },
                  set: function (w) {
                    ((y = w), !a.name && !a.displayName && (a.displayName = w));
                  },
                });
              }
              return u;
            }
            var ai;
            ai = Symbol.for("react.module.reference");
            function ci(a) {
              return !!(
                typeof a == "string" ||
                typeof a == "function" ||
                a === n ||
                a === l ||
                I ||
                a === s ||
                a === f ||
                a === _ ||
                Ye ||
                a === T ||
                Xe ||
                gt ||
                nt ||
                (typeof a == "object" &&
                  a !== null &&
                  (a.$$typeof === O ||
                    a.$$typeof === C ||
                    a.$$typeof === c ||
                    a.$$typeof === h ||
                    a.$$typeof === d ||
                    a.$$typeof === ai ||
                    a.getModuleId !== void 0))
              );
            }
            function hn(a, u) {
              ci(a) ||
                k(
                  "memo: The first argument must be a component. Instead received: %s",
                  a === null ? "null" : typeof a,
                );
              var y = {
                $$typeof: C,
                type: a,
                compare: u === void 0 ? null : u,
              };
              {
                var w;
                Object.defineProperty(y, "displayName", {
                  enumerable: !1,
                  configurable: !0,
                  get: function () {
                    return w;
                  },
                  set: function (D) {
                    ((w = D), !a.name && !a.displayName && (a.displayName = D));
                  },
                });
              }
              return y;
            }
            function ke() {
              var a = G.current;
              return (
                a === null &&
                  k(`Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:
1. You might have mismatching versions of React and the renderer (such as React DOM)
2. You might be breaking the Rules of Hooks
3. You might have more than one copy of React in the same app
See https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.`),
                a
              );
            }
            function un(a) {
              var u = ke();
              if (a._context !== void 0) {
                var y = a._context;
                y.Consumer === a
                  ? k(
                      "Calling useContext(Context.Consumer) is not supported, may cause bugs, and will be removed in a future major release. Did you mean to call useContext(Context) instead?",
                    )
                  : y.Provider === a &&
                    k(
                      "Calling useContext(Context.Provider) is not supported. Did you mean to call useContext(Context) instead?",
                    );
              }
              return u.useContext(a);
            }
            function fn(a) {
              var u = ke();
              return u.useState(a);
            }
            function mn(a, u, y) {
              var w = ke();
              return w.useReducer(a, u, y);
            }
            function vn(a) {
              var u = ke();
              return u.useRef(a);
            }
            function gn(a, u) {
              var y = ke();
              return y.useEffect(a, u);
            }
            function yn(a, u) {
              var y = ke();
              return y.useInsertionEffect(a, u);
            }
            function _n(a, u) {
              var y = ke();
              return y.useLayoutEffect(a, u);
            }
            function wn(a, u) {
              var y = ke();
              return y.useCallback(a, u);
            }
            function Cn(a, u) {
              var y = ke();
              return y.useMemo(a, u);
            }
            function Sn(a, u, y) {
              var w = ke();
              return w.useImperativeHandle(a, u, y);
            }
            function kn(a, u) {
              {
                var y = ke();
                return y.useDebugValue(a, u);
              }
            }
            function En() {
              var a = ke();
              return a.useTransition();
            }
            function Dn(a) {
              var u = ke();
              return u.useDeferredValue(a);
            }
            function Nn() {
              var a = ke();
              return a.useId();
            }
            function In(a, u, y) {
              var w = ke();
              return w.useSyncExternalStore(a, u, y);
            }
            var wt = 0,
              li,
              di,
              pi,
              hi,
              ui,
              fi,
              mi;
            function vi() {}
            vi.__reactDisabledLog = !0;
            function Tn() {
              {
                if (wt === 0) {
                  ((li = console.log),
                    (di = console.info),
                    (pi = console.warn),
                    (hi = console.error),
                    (ui = console.group),
                    (fi = console.groupCollapsed),
                    (mi = console.groupEnd));
                  var a = {
                    configurable: !0,
                    enumerable: !0,
                    value: vi,
                    writable: !0,
                  };
                  Object.defineProperties(console, {
                    info: a,
                    log: a,
                    warn: a,
                    error: a,
                    group: a,
                    groupCollapsed: a,
                    groupEnd: a,
                  });
                }
                wt++;
              }
            }
            function bn() {
              {
                if ((wt--, wt === 0)) {
                  var a = { configurable: !0, enumerable: !0, writable: !0 };
                  Object.defineProperties(console, {
                    log: S({}, a, { value: li }),
                    info: S({}, a, { value: di }),
                    warn: S({}, a, { value: pi }),
                    error: S({}, a, { value: hi }),
                    group: S({}, a, { value: ui }),
                    groupCollapsed: S({}, a, { value: fi }),
                    groupEnd: S({}, a, { value: mi }),
                  });
                }
                wt < 0 &&
                  k(
                    "disabledDepth fell below zero. This is a bug in React. Please file an issue.",
                  );
              }
            }
            var hr = E.ReactCurrentDispatcher,
              ur;
            function Mt(a, u, y) {
              {
                if (ur === void 0)
                  try {
                    throw Error();
                  } catch (D) {
                    var w = D.stack.trim().match(/\n( *(at )?)/);
                    ur = (w && w[1]) || "";
                  }
                return (
                  `
` +
                  ur +
                  a
                );
              }
            }
            var fr = !1,
              Pt;
            {
              var On = typeof WeakMap == "function" ? WeakMap : Map;
              Pt = new On();
            }
            function gi(a, u) {
              if (!a || fr) return "";
              {
                var y = Pt.get(a);
                if (y !== void 0) return y;
              }
              var w;
              fr = !0;
              var D = Error.prepareStackTrace;
              Error.prepareStackTrace = void 0;
              var x;
              ((x = hr.current), (hr.current = null), Tn());
              try {
                if (u) {
                  var K = function () {
                    throw Error();
                  };
                  if (
                    (Object.defineProperty(K.prototype, "props", {
                      set: function () {
                        throw Error();
                      },
                    }),
                    typeof Reflect == "object" && Reflect.construct)
                  ) {
                    try {
                      Reflect.construct(K, []);
                    } catch (_e) {
                      w = _e;
                    }
                    Reflect.construct(a, [], K);
                  } else {
                    try {
                      K.call();
                    } catch (_e) {
                      w = _e;
                    }
                    a.call(K.prototype);
                  }
                } else {
                  try {
                    throw Error();
                  } catch (_e) {
                    w = _e;
                  }
                  a();
                }
              } catch (_e) {
                if (_e && w && typeof _e.stack == "string") {
                  for (
                    var j = _e.stack.split(`
`),
                      J = w.stack.split(`
`),
                      q = j.length - 1,
                      re = J.length - 1;
                    q >= 1 && re >= 0 && j[q] !== J[re];

                  )
                    re--;
                  for (; q >= 1 && re >= 0; q--, re--)
                    if (j[q] !== J[re]) {
                      if (q !== 1 || re !== 1)
                        do
                          if ((q--, re--, re < 0 || j[q] !== J[re])) {
                            var ie =
                              `
` + j[q].replace(" at new ", " at ");
                            return (
                              a.displayName &&
                                ie.includes("<anonymous>") &&
                                (ie = ie.replace("<anonymous>", a.displayName)),
                              typeof a == "function" && Pt.set(a, ie),
                              ie
                            );
                          }
                        while (q >= 1 && re >= 0);
                      break;
                    }
                }
              } finally {
                ((fr = !1),
                  (hr.current = x),
                  bn(),
                  (Error.prepareStackTrace = D));
              }
              var ce = a ? a.displayName || a.name : "",
                pe = ce ? Mt(ce) : "";
              return (typeof a == "function" && Pt.set(a, pe), pe);
            }
            function Kn(a, u, y) {
              return gi(a, !1);
            }
            function Fn(a) {
              var u = a.prototype;
              return !!(u && u.isReactComponent);
            }
            function Rt(a, u, y) {
              if (a == null) return "";
              if (typeof a == "function") return gi(a, Fn(a));
              if (typeof a == "string") return Mt(a);
              switch (a) {
                case f:
                  return Mt("Suspense");
                case _:
                  return Mt("SuspenseList");
              }
              if (typeof a == "object")
                switch (a.$$typeof) {
                  case d:
                    return Kn(a.render);
                  case C:
                    return Rt(a.type, u, y);
                  case O: {
                    var w = a,
                      D = w._payload,
                      x = w._init;
                    try {
                      return Rt(x(D), u, y);
                    } catch {}
                  }
                }
              return "";
            }
            var yi = {},
              _i = E.ReactDebugCurrentFrame;
            function Lt(a) {
              if (a) {
                var u = a._owner,
                  y = Rt(a.type, a._source, u ? u.type : null);
                _i.setExtraStackFrame(y);
              } else _i.setExtraStackFrame(null);
            }
            function An(a, u, y, w, D) {
              {
                var x = Function.call.bind(yt);
                for (var K in a)
                  if (x(a, K)) {
                    var j = void 0;
                    try {
                      if (typeof a[K] != "function") {
                        var J = Error(
                          (w || "React class") +
                            ": " +
                            y +
                            " type `" +
                            K +
                            "` is invalid; it must be a function, usually from the `prop-types` package, but received `" +
                            typeof a[K] +
                            "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.",
                        );
                        throw ((J.name = "Invariant Violation"), J);
                      }
                      j = a[K](
                        u,
                        K,
                        w,
                        y,
                        null,
                        "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED",
                      );
                    } catch (q) {
                      j = q;
                    }
                    (j &&
                      !(j instanceof Error) &&
                      (Lt(D),
                      k(
                        "%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).",
                        w || "React class",
                        y,
                        K,
                        typeof j,
                      ),
                      Lt(null)),
                      j instanceof Error &&
                        !(j.message in yi) &&
                        ((yi[j.message] = !0),
                        Lt(D),
                        k("Failed %s type: %s", y, j.message),
                        Lt(null)));
                  }
              }
            }
            function at(a) {
              if (a) {
                var u = a._owner,
                  y = Rt(a.type, a._source, u ? u.type : null);
                ot(y);
              } else ot(null);
            }
            var mr;
            mr = !1;
            function wi() {
              if (ge.current) {
                var a = Ue(ge.current.type);
                if (a)
                  return (
                    `

Check the render method of \`` +
                    a +
                    "`."
                  );
              }
              return "";
            }
            function Mn(a) {
              if (a !== void 0) {
                var u = a.fileName.replace(/^.*[\\\/]/, ""),
                  y = a.lineNumber;
                return (
                  `

Check your code at ` +
                  u +
                  ":" +
                  y +
                  "."
                );
              }
              return "";
            }
            function Pn(a) {
              return a != null ? Mn(a.__source) : "";
            }
            var Ci = {};
            function Rn(a) {
              var u = wi();
              if (!u) {
                var y = typeof a == "string" ? a : a.displayName || a.name;
                y &&
                  (u =
                    `

Check the top-level render call using <` +
                    y +
                    ">.");
              }
              return u;
            }
            function Si(a, u) {
              if (!(!a._store || a._store.validated || a.key != null)) {
                a._store.validated = !0;
                var y = Rn(u);
                if (!Ci[y]) {
                  Ci[y] = !0;
                  var w = "";
                  (a &&
                    a._owner &&
                    a._owner !== ge.current &&
                    (w =
                      " It was passed a child from " + Ue(a._owner.type) + "."),
                    at(a),
                    k(
                      'Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.',
                      y,
                      w,
                    ),
                    at(null));
                }
              }
            }
            function ki(a, u) {
              if (typeof a == "object") {
                if (Ot(a))
                  for (var y = 0; y < a.length; y++) {
                    var w = a[y];
                    st(w) && Si(w, u);
                  }
                else if (st(a)) a._store && (a._store.validated = !0);
                else if (a) {
                  var D = H(a);
                  if (typeof D == "function" && D !== a.entries)
                    for (var x = D.call(a), K; !(K = x.next()).done; )
                      st(K.value) && Si(K.value, u);
                }
              }
            }
            function Ei(a) {
              {
                var u = a.type;
                if (u == null || typeof u == "string") return;
                var y;
                if (typeof u == "function") y = u.propTypes;
                else if (
                  typeof u == "object" &&
                  (u.$$typeof === d || u.$$typeof === C)
                )
                  y = u.propTypes;
                else return;
                if (y) {
                  var w = Ue(u);
                  An(y, a.props, "prop", w, a);
                } else if (u.PropTypes !== void 0 && !mr) {
                  mr = !0;
                  var D = Ue(u);
                  k(
                    "Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?",
                    D || "Unknown",
                  );
                }
                typeof u.getDefaultProps == "function" &&
                  !u.getDefaultProps.isReactClassApproved &&
                  k(
                    "getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.",
                  );
              }
            }
            function Ln(a) {
              {
                for (var u = Object.keys(a.props), y = 0; y < u.length; y++) {
                  var w = u[y];
                  if (w !== "children" && w !== "key") {
                    (at(a),
                      k(
                        "Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.",
                        w,
                      ),
                      at(null));
                    break;
                  }
                }
                a.ref !== null &&
                  (at(a),
                  k("Invalid attribute `ref` supplied to `React.Fragment`."),
                  at(null));
              }
            }
            function Di(a, u, y) {
              var w = ci(a);
              if (!w) {
                var D = "";
                (a === void 0 ||
                  (typeof a == "object" &&
                    a !== null &&
                    Object.keys(a).length === 0)) &&
                  (D +=
                    " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.");
                var x = Pn(u);
                x ? (D += x) : (D += wi());
                var K;
                (a === null
                  ? (K = "null")
                  : Ot(a)
                    ? (K = "array")
                    : a !== void 0 && a.$$typeof === r
                      ? ((K = "<" + (Ue(a.type) || "Unknown") + " />"),
                        (D =
                          " Did you accidentally export a JSX literal instead of a component?"))
                      : (K = typeof a),
                  k(
                    "React.createElement: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s",
                    K,
                    D,
                  ));
              }
              var j = Yo.apply(this, arguments);
              if (j == null) return j;
              if (w)
                for (var J = 2; J < arguments.length; J++) ki(arguments[J], a);
              return (a === n ? Ln(j) : Ei(j), j);
            }
            var Ni = !1;
            function $n(a) {
              var u = Di.bind(null, a);
              return (
                (u.type = a),
                Ni ||
                  ((Ni = !0),
                  A(
                    "React.createFactory() is deprecated and will be removed in a future major release. Consider using JSX or use React.createElement() directly instead.",
                  )),
                Object.defineProperty(u, "type", {
                  enumerable: !1,
                  get: function () {
                    return (
                      A(
                        "Factory.type is deprecated. Access the class directly before passing it to createFactory.",
                      ),
                      Object.defineProperty(this, "type", { value: a }),
                      a
                    );
                  },
                }),
                u
              );
            }
            function xn(a, u, y) {
              for (
                var w = Zo.apply(this, arguments), D = 2;
                D < arguments.length;
                D++
              )
                ki(arguments[D], w.type);
              return (Ei(w), w);
            }
            function Wn(a, u) {
              var y = oe.transition;
              oe.transition = {};
              var w = oe.transition;
              oe.transition._updatedFibers = new Set();
              try {
                a();
              } finally {
                if (((oe.transition = y), y === null && w._updatedFibers)) {
                  var D = w._updatedFibers.size;
                  (D > 10 &&
                    A(
                      "Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table.",
                    ),
                    w._updatedFibers.clear());
                }
              }
            }
            var Ii = !1,
              $t = null;
            function jn(a) {
              if ($t === null)
                try {
                  var u = ("require" + Math.random()).slice(0, 7),
                    y = o && o[u];
                  $t = y.call(o, "timers").setImmediate;
                } catch {
                  $t = function (w) {
                    Ii === !1 &&
                      ((Ii = !0),
                      typeof MessageChannel > "u" &&
                        k(
                          "This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning.",
                        ));
                    var D = new MessageChannel();
                    ((D.port1.onmessage = w), D.port2.postMessage(void 0));
                  };
                }
              return $t(a);
            }
            var ct = 0,
              Ti = !1;
            function bi(a) {
              {
                var u = ct;
                (ct++, ne.current === null && (ne.current = []));
                var y = ne.isBatchingLegacy,
                  w;
                try {
                  if (
                    ((ne.isBatchingLegacy = !0),
                    (w = a()),
                    !y && ne.didScheduleLegacyUpdate)
                  ) {
                    var D = ne.current;
                    D !== null && ((ne.didScheduleLegacyUpdate = !1), yr(D));
                  }
                } catch (ce) {
                  throw (xt(u), ce);
                } finally {
                  ne.isBatchingLegacy = y;
                }
                if (
                  w !== null &&
                  typeof w == "object" &&
                  typeof w.then == "function"
                ) {
                  var x = w,
                    K = !1,
                    j = {
                      then: function (ce, pe) {
                        ((K = !0),
                          x.then(
                            function (_e) {
                              (xt(u), ct === 0 ? vr(_e, ce, pe) : ce(_e));
                            },
                            function (_e) {
                              (xt(u), pe(_e));
                            },
                          ));
                      },
                    };
                  return (
                    !Ti &&
                      typeof Promise < "u" &&
                      Promise.resolve()
                        .then(function () {})
                        .then(function () {
                          K ||
                            ((Ti = !0),
                            k(
                              "You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);",
                            ));
                        }),
                    j
                  );
                } else {
                  var J = w;
                  if ((xt(u), ct === 0)) {
                    var q = ne.current;
                    q !== null && (yr(q), (ne.current = null));
                    var re = {
                      then: function (ce, pe) {
                        ne.current === null
                          ? ((ne.current = []), vr(J, ce, pe))
                          : ce(J);
                      },
                    };
                    return re;
                  } else {
                    var ie = {
                      then: function (ce, pe) {
                        ce(J);
                      },
                    };
                    return ie;
                  }
                }
              }
            }
            function xt(a) {
              (a !== ct - 1 &&
                k(
                  "You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. ",
                ),
                (ct = a));
            }
            function vr(a, u, y) {
              {
                var w = ne.current;
                if (w !== null)
                  try {
                    (yr(w),
                      jn(function () {
                        w.length === 0
                          ? ((ne.current = null), u(a))
                          : vr(a, u, y);
                      }));
                  } catch (D) {
                    y(D);
                  }
                else u(a);
              }
            }
            var gr = !1;
            function yr(a) {
              if (!gr) {
                gr = !0;
                var u = 0;
                try {
                  for (; u < a.length; u++) {
                    var y = a[u];
                    do y = y(!0);
                    while (y !== null);
                  }
                  a.length = 0;
                } catch (w) {
                  throw ((a = a.slice(u + 1)), w);
                } finally {
                  gr = !1;
                }
              }
            }
            var Un = Di,
              Vn = xn,
              Bn = $n,
              Gn = { map: At, forEach: on, count: rn, toArray: nn, only: sn };
            ((e.Children = Gn),
              (e.Component = M),
              (e.Fragment = n),
              (e.Profiler = l),
              (e.PureComponent = ee),
              (e.StrictMode = s),
              (e.Suspense = f),
              (e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = E),
              (e.act = bi),
              (e.cloneElement = Vn),
              (e.createContext = an),
              (e.createElement = Un),
              (e.createFactory = Bn),
              (e.createRef = Uo),
              (e.forwardRef = pn),
              (e.isValidElement = st),
              (e.lazy = dn),
              (e.memo = hn),
              (e.startTransition = Wn),
              (e.unstable_act = bi),
              (e.useCallback = wn),
              (e.useContext = un),
              (e.useDebugValue = kn),
              (e.useDeferredValue = Dn),
              (e.useEffect = gn),
              (e.useId = Nn),
              (e.useImperativeHandle = Sn),
              (e.useInsertionEffect = yn),
              (e.useLayoutEffect = _n),
              (e.useMemo = Cn),
              (e.useReducer = mn),
              (e.useRef = vn),
              (e.useState = fn),
              (e.useSyncExternalStore = In),
              (e.useTransition = En),
              (e.version = t),
              typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" &&
                typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop ==
                  "function" &&
                __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(
                  new Error(),
                ));
          })();
      })(jt, jt.exports)),
    jt.exports
  );
}
process.env.NODE_ENV === "production" ? Es() : Ds();
class He {
  constructor(e, t, r, i, n) {
    v(this, "effect");
    v(this, "brightness");
    v(this, "speed");
    v(this, "magic");
    v(this, "color");
    ((this.effect = e),
      (this.brightness = t),
      (this.speed = r),
      (this.magic = i),
      (this.color = n));
  }
  copy(e = {}) {
    return new He(
      e.effect ?? this.effect,
      e.brightness ?? this.brightness,
      e.speed ?? this.speed,
      e.magic ?? this.magic,
      e.color ?? this.color,
    );
  }
  static rehydrate(e) {
    return new He(e.effect, e.brightness, e.speed, e.magic, e.color);
  }
  toDTO() {
    return {
      effect: this.effect,
      brightness: this.brightness,
      speed: this.speed,
      magic: this.magic,
      color: this.color !== void 0 ? Ji(this.color) : void 0,
    };
  }
  static fromDTO(e) {
    return new He(
      e.effect,
      e.brightness,
      e.speed,
      e.magic,
      e.color !== void 0 && e.color != null
        ? `#${e.color.toString(16).toUpperCase().padStart(6, "0")}`
        : void 0,
    );
  }
}
class Pe {
  constructor(e, t) {
    v(this, "backlight");
    v(this, "underglow");
    ((this.backlight = e), (this.underglow = t));
  }
  copy(e = {}) {
    var t, r;
    return new Pe(
      ((t = e.backlight) == null ? void 0 : t.copy()) ?? this.backlight.copy(),
      ((r = e.underglow) == null ? void 0 : r.copy()) ?? this.underglow.copy(),
    );
  }
  static rehydrate(e) {
    return new Pe(He.rehydrate(e.backlight), He.rehydrate(e.underglow));
  }
  toDTO() {
    return {
      backlight: this.backlight.toDTO(),
      underglow: this.underglow.toDTO(),
    };
  }
  static fromDTO(e) {
    return new Pe(He.fromDTO(e.backlight), He.fromDTO(e.underglow));
  }
}
class mt {
  constructor(e, t, r = "Layer", i = "#F00", n, s, l) {
    v(this, "id");
    v(this, "name");
    v(this, "color");
    v(this, "layout");
    v(this, "os");
    v(this, "lights");
    v(this, "linkedAppId");
    let c;
    if (n !== void 0) c = n;
    else
      try {
        c =
          commonChannel !== void 0 && commonChannel.platform === "darwin"
            ? 0
            : 1;
      } catch {
        c = 0;
      }
    ((this.name = r),
      (this.color = i),
      (this.layout = t),
      (this.id = e),
      (this.os = c),
      (this.lights = s),
      (this.linkedAppId = l));
  }
  static rehydrate(e) {
    const t = e.lights ? Pe.rehydrate(e.lights) : void 0;
    return new mt(e.id, e.layout, e.name, e.color, e.os, t, e.linkedAppId);
  }
  copy(e = {}) {
    var t, r, i;
    return new mt(
      e.id ?? this.id,
      e.layout ?? {
        encoders: this.layout.encoders.map((n) =>
          JSON.parse(JSON.stringify(n)),
        ),
        buttons:
          (t = this.layout.buttons) == null
            ? void 0
            : t.map((n) => JSON.parse(JSON.stringify(n))),
        joystick: this.layout.joystick
          ? JSON.parse(JSON.stringify(this.layout.joystick))
          : void 0,
        base: this.layout.base.map((n) => JSON.parse(JSON.stringify(n))),
      },
      e.name ?? this.name,
      e.color ?? this.color,
      e.os ?? this.os,
      ((r = e.lights) == null ? void 0 : r.copy()) ??
        ((i = this.lights) == null ? void 0 : i.copy()),
      e.linkedAppId ?? this.linkedAppId,
    );
  }
  static getActionIdsFromLayer(e) {
    var r, i, n;
    let t = new Set();
    return (
      e.layout.encoders.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("KA_")) {
            const h = c.replace("KA_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      ),
      (r = e.layout.buttons) == null ||
        r.forEach((s) =>
          s.forEach((l) => {
            const c = l.keycode;
            if (c.startsWith("KA_")) {
              const h = c.replace("KA_", ""),
                d = parseInt(h);
              t.add(d);
            }
          }),
        ),
      e.layout.base.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("KA_")) {
            const h = c.replace("KA_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      ),
      (n = (i = e.layout.joystick) == null ? void 0 : i.sectors) == null ||
        n.forEach((s) => {
          if (s.k.startsWith("KA_")) {
            const l = s.k.replace("KA_", ""),
              c = parseInt(l);
            t.add(c);
          }
        }),
      t
    );
  }
  static replaceAllStartingKeycode(e, t, r) {
    var n, s, l;
    let i = e.layout;
    return (
      i.encoders.forEach((c) =>
        c.forEach((h) => {
          h.keycode.startsWith(t) && (h.keycode = h.keycode.replace(t, r));
        }),
      ),
      (n = i.buttons) == null ||
        n.forEach((c) =>
          c.forEach((h) => {
            h.keycode.startsWith(t) && (h.keycode = h.keycode.replace(t, r));
          }),
        ),
      i.base.forEach((c) =>
        c.forEach((h) => {
          h.keycode.startsWith(t) && (h.keycode = h.keycode.replace(t, r));
        }),
      ),
      (l = (s = i.joystick) == null ? void 0 : s.sectors) == null ||
        l.forEach((c) => {
          c.k.startsWith(t) && (c.k = c.k.replace(t, r));
        }),
      e
    );
  }
  static getActionsFromLayer(e, t, r) {
    var l, c, h;
    let i = [],
      n = new Set(),
      s = new Set();
    return (
      e.layout.encoders.forEach((d) =>
        d.forEach((f) => {
          const _ = f.keycode;
          if (_.startsWith("KA_")) {
            const C = _.replace("KA_", ""),
              O = parseInt(C);
            n.add(O);
          } else if (_.startsWith("KM_")) {
            const C = _.replace("KM_", ""),
              O = parseInt(C);
            s.add(O);
          }
        }),
      ),
      (l = e.layout.buttons) == null ||
        l.forEach((d) =>
          d.forEach((f) => {
            const _ = f.keycode;
            if (_.startsWith("KA_")) {
              const C = _.replace("KA_", ""),
                O = parseInt(C);
              n.add(O);
            } else if (_.startsWith("KM_")) {
              const C = _.replace("KM_", ""),
                O = parseInt(C);
              s.add(O);
            }
          }),
        ),
      e.layout.base.forEach((d) =>
        d.forEach((f) => {
          const _ = f.keycode;
          if (_.startsWith("KA_")) {
            const C = _.replace("KA_", ""),
              O = parseInt(C);
            n.add(O);
          } else if (_.startsWith("KM_")) {
            const C = _.replace("KM_", ""),
              O = parseInt(C);
            s.add(O);
          }
        }),
      ),
      (h = (c = e.layout.joystick) == null ? void 0 : c.sectors) == null ||
        h.forEach((d) => {
          const f = d.k;
          if (f.startsWith("KA_")) {
            const _ = f.replace("KA_", ""),
              C = parseInt(_);
            n.add(C);
          } else if (f.startsWith("KM_")) {
            const _ = f.replace("KM_", ""),
              C = parseInt(_);
            s.add(C);
          }
        }),
      s.forEach((d) => {
        const f = r.find((_) => _.id === d);
        f !== void 0 &&
          this.getActionIdsFromMultiaction(f, r).forEach((_) => n.add(_));
      }),
      n.forEach((d) => {
        this.getAllActionIdsFromActionId(d, t).forEach((f) => n.add(f));
      }),
      n.forEach((d) => {
        const f = t.find((_) => _.id === d);
        f !== void 0 && i.push(f);
      }),
      i
    );
  }
  static getActionIdsFromMultiaction(e, t) {
    let r = new Set();
    const i = e.tap.keycode;
    if (i.startsWith("KM_")) {
      const c = i.replace("KA_", ""),
        h = parseInt(c),
        d = t.find((f) => f.id === h);
      d !== void 0 &&
        this.getActionIdsFromMultiaction(d, t).forEach((f) => r.add(f));
    } else if (i.startsWith("KA_")) {
      const c = i.replace("KA_", ""),
        h = parseInt(c);
      r.add(h);
    }
    const n = e.onHold.keycode;
    if (n.startsWith("KM_")) {
      const c = n.replace("KA_", ""),
        h = parseInt(c),
        d = t.find((f) => f.id === h);
      d !== void 0 &&
        this.getActionIdsFromMultiaction(d, t).forEach((f) => r.add(f));
    } else if (n.startsWith("KA_")) {
      const c = n.replace("KA_", ""),
        h = parseInt(c);
      r.add(h);
    }
    const s = e.doubleTap.keycode;
    if (s.startsWith("KM_")) {
      const c = s.replace("KA_", ""),
        h = parseInt(c),
        d = t.find((f) => f.id === h);
      d !== void 0 &&
        this.getActionIdsFromMultiaction(d, t).forEach((f) => r.add(f));
    } else if (s.startsWith("KA_")) {
      const c = s.replace("KA_", ""),
        h = parseInt(c);
      r.add(h);
    }
    const l = e.tapHold.keycode;
    if (l.startsWith("KM_")) {
      const c = l.replace("KA_", ""),
        h = parseInt(c),
        d = t.find((f) => f.id === h);
      d !== void 0 &&
        this.getActionIdsFromMultiaction(d, t).forEach((f) => r.add(f));
    } else if (l.startsWith("KA_")) {
      const c = l.replace("KA_", ""),
        h = parseInt(c);
      r.add(h);
    }
    return r;
  }
  static getAllActionIdsFromActionId(e, t) {
    const r = new Set(),
      i = t.find((n) => n.id === e);
    return (
      i !== void 0 &&
        i.keyInputs.forEach((n) => {
          if (n.keycode.startsWith("KA_")) {
            const s = n.keycode.replace("KA_", ""),
              l = parseInt(s);
            this.getAllActionIdsFromActionId(l, t).forEach((c) => r.add(c));
          }
          r.add(e);
        }),
      r
    );
  }
  static getMultiactionsIdsFromLayer(e) {
    var r, i, n;
    let t = new Set();
    return (
      e.layout.encoders.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("KM_")) {
            const h = c.replace("KM_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      ),
      (r = e.layout.buttons) == null ||
        r.forEach((s) =>
          s.forEach((l) => {
            const c = l.keycode;
            if (c.startsWith("KM_")) {
              const h = c.replace("KM_", ""),
                d = parseInt(h);
              t.add(d);
            }
          }),
        ),
      e.layout.base.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("KM_")) {
            const h = c.replace("KM_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      ),
      (n = (i = e.layout.joystick) == null ? void 0 : i.sectors) == null ||
        n.forEach((s) => {
          const l = s.k;
          if (l.startsWith("KM_")) {
            const c = l.replace("KM_", ""),
              h = parseInt(c);
            t.add(h);
          }
        }),
      t
    );
  }
  static getMultiaActionFromLayer(e, t) {
    var n;
    let r = [],
      i = new Set();
    return (
      e.layout.encoders.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("KM_")) {
            const h = c.replace("KM_", ""),
              d = parseInt(h);
            i.add(d);
          }
        }),
      ),
      (n = e.layout.buttons) == null ||
        n.forEach((s) =>
          s.forEach((l) => {
            const c = l.keycode;
            if (c.startsWith("KM_")) {
              const h = c.replace("KM_", ""),
                d = parseInt(h);
              i.add(d);
            }
          }),
        ),
      e.layout.base.forEach((s) => {
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("KM_")) {
            const h = c.replace("KM_", ""),
              d = parseInt(h);
            i.add(d);
          }
        });
      }),
      i.forEach((s) => {
        const l = t.find((c) => c.id === s);
        l !== void 0 && r.push(l);
      }),
      r
    );
  }
  static getSmartActionIdsFromLayer(e) {
    var r, i, n;
    let t = new Set();
    return (
      e.layout.encoders.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("SA_")) {
            const h = c.replace("SA_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      ),
      (r = e.layout.buttons) == null ||
        r.forEach((s) =>
          s.forEach((l) => {
            const c = l.keycode;
            if (c.startsWith("SA_")) {
              const h = c.replace("SA_", ""),
                d = parseInt(h);
              t.add(d);
            }
          }),
        ),
      e.layout.base.forEach((s) =>
        s.forEach((l) => {
          const c = l.keycode;
          if (c.startsWith("SA_")) {
            const h = c.replace("SA_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      ),
      (n = (i = e.layout.joystick) == null ? void 0 : i.sectors) == null ||
        n.forEach((s) => {
          if (s.k.startsWith("SA_")) {
            const l = s.k.replace("SA_", ""),
              c = parseInt(l);
            t.add(c);
          }
        }),
      t
    );
  }
  static getSmartActionsFromLayer(e, t) {
    let r = [];
    return (
      mt.getSmartActionIdsFromLayer(e).forEach((i) => {
        const n = t.find((s) => s.id === i);
        n !== void 0 && r.push(n);
      }),
      r
    );
  }
  static updateLayerWithNewActionId(e, t, r) {
    var n, s, l;
    let i = e.layout;
    return (
      i.encoders.forEach((c) =>
        c.forEach((h) => {
          h.keycode === t && (h.keycode = r);
        }),
      ),
      (n = i.buttons) == null ||
        n.forEach((c) =>
          c.forEach((h) => {
            h.keycode === t && (h.keycode = r);
          }),
        ),
      i.base.forEach((c) =>
        c.forEach((h) => {
          h.keycode === t && (h.keycode = r);
        }),
      ),
      (l = (s = i.joystick) == null ? void 0 : s.sectors) == null ||
        l.forEach((c) => {
          c.k === t && (c.k = r);
        }),
      e
    );
  }
  toDTO() {
    try {
      const e = this.layout
        ? JSON.parse(JSON.stringify(this.layout))
        : { encoders: [], base: [] };
      return {
        id: this.id,
        name: this.name,
        color: this.color,
        layout: e,
        os: this.os,
        lights: this.lights ? Pe.rehydrate(this.lights).toDTO() : void 0,
        linkedAppId: this.linkedAppId,
      };
    } catch (e) {
      throw (console.error("|layer| failed to serialize with error: " + e), e);
    }
  }
  static fromJSON(e) {
    try {
      const t = typeof e.name == "string" ? e.name : "Layer",
        r = typeof e.color == "string" ? e.color : "#F00",
        i = e.layout,
        n = e.os,
        s = e.lights ? Pe.fromDTO(e.lights) : void 0,
        l = e.linkedAppId;
      return new mt(e.id, i, t, r, n, s, l);
    } catch (t) {
      throw (console.error(), t);
    }
  }
}
function Be(o, e) {
  if (o === e) return !0;
  if (o === null || e === null || typeof o != "object" || typeof e != "object")
    return (
      console.log(
        "Objects are different, first object: " + o + " second object " + e,
      ),
      !1
    );
  const t = Object.keys(o).filter((i) => o[i] !== void 0),
    r = Object.keys(e).filter((i) => e[i] !== void 0);
  if (t.length !== r.length)
    return (
      console.log(
        "Objects have different key length, first: " +
          t.length +
          " second: " +
          r.length,
      ),
      !1
    );
  for (const i of t)
    if (!r.includes(i) || !Be(o[i], e[i])) {
      if (i === "color" && typeof o[i] == "string" && typeof e[i] == "string") {
        const n = Hi(o[i]),
          s = Hi(e[i]);
        if (n === s) return !0;
      }
      return (
        console.log(
          "Objects are different, first object: " +
            o +
            " second object: " +
            e +
            " key: " +
            i,
        ),
        !1
      );
    }
  return !0;
}
function Hi(o) {
  return (
    (o = o.startsWith("#") ? o.slice(1) : o),
    o.length === 3 &&
      (o = o
        .split("")
        .map((e) => e + e)
        .join("")),
    o.toUpperCase()
  );
}
function Ji(o) {
  let e = o.replace("#", "");
  return (
    e.length === 3 &&
      (e = e
        .split("")
        .map((t) => t + t)
        .join("")),
    parseInt(e, 16)
  );
}
function $e(o) {
  return o.startsWith("KA_")
    ? o.replace("KA_", "KA_A")
    : o.startsWith("KM_")
      ? o.replace("KM_", "KA_M")
      : o;
}
function zi(o) {
  return o.startsWith("KA_A")
    ? o.replace("KA_A", "KA_")
    : o.startsWith("KA_M")
      ? o.replace("KA_M", "KM_")
      : o.startsWith("KC_FUNC")
        ? o.replace("KC_FUNC", "KI_FP")
        : o;
}
var Nr = ((o) => (
  (o[(o.RELEASE = 0)] = "RELEASE"),
  (o[(o.PRESS = 1)] = "PRESS"),
  (o[(o.CLICK = 2)] = "CLICK"),
  o
))(Nr || {});
class X {
  constructor(e = "KC_NONE", t = 0, r = Nr.PRESS) {
    v(this, "keycode");
    v(this, "delay");
    v(this, "actionType");
    ((this.keycode = e), (this.delay = t), (this.actionType = r));
  }
  copy(e = {}) {
    return new X(
      e.keycode ?? this.keycode,
      e.delay ?? this.delay,
      e.actionType ?? this.actionType,
    );
  }
  static rehydrate(e) {
    return new X(e.keycode, e.delay, e.actionType);
  }
  toDTO() {
    return {
      keycode: this.keycode,
      delay: this.delay,
      actionType: this.actionType,
    };
  }
  toDeviceJson() {
    return { kc: $e(this.keycode), delay: this.delay, act: this.actionType };
  }
  static fromDTO(e) {
    if (!e) throw new Error("Invalid JSON for KeyInput");
    return new X(e.keycode, e.delay, e.actionType);
  }
  static fromDeviceAction(e) {
    if (!e) throw new Error("Invalid JSON for KeyInput");
    return new X(zi(e.kc), e.delay, e.act);
  }
  static fromDeviceMultiaction(e) {
    if (!e) throw new Error("Invalid JSON for KeyInput");
    return new X(zi(e));
  }
}
class rt {
  constructor(e, t, r, i) {
    v(this, "id");
    v(this, "name");
    v(this, "color", null);
    v(this, "icon");
    ((this.id = e),
      (this.name = t),
      (this.icon = i),
      r != null && (this.color = r));
  }
  copy(e = {}) {
    return new rt(
      e.id ?? this.id,
      e.name ?? this.name,
      e.color ?? this.color ?? void 0,
      e.icon ?? this.icon,
    );
  }
  toDTO() {
    try {
      return {
        id: this.id,
        name: this.name,
        color: this.color,
        icon: this.icon,
      };
    } catch (e) {
      throw (
        console.error("|base_action| failed to serialize with error: " + e),
        e
      );
    }
  }
  toDeviceJson() {
    try {
      return {
        id: this.id,
        name: this.name,
        color: this.color,
        icon: this.icon,
      };
    } catch (e) {
      throw (
        console.error("|base_action| failed to serialize with error: " + e),
        e
      );
    }
  }
  static fromJSON(e) {
    if (!e) throw new Error("Invalid JSON for BaseAction");
    return new rt(e.id, e.name, e.color, e.icon);
  }
  static fromDeviceJson(e) {
    if (!e) throw new Error("Invalid JSON for BaseAction");
    return new rt(e.id, e.name, e.color, e.icon);
  }
}
class Je extends rt {
  constructor(t, r = "My Action", i, n, s) {
    super(t, r, i, s);
    v(this, "keyInputs");
    n != null ? (this.keyInputs = n) : (this.keyInputs = new Array(new X()));
  }
  copy(t = {}) {
    var r, i;
    return new Je(
      t.id ?? this.id,
      t.name ?? this.name,
      t.color ?? this.color ?? void 0,
      ((r = t.keyInputs) == null ? void 0 : r.map((n) => n.copy())) ??
        ((i = this.keyInputs) == null ? void 0 : i.map((n) => n.copy())) ??
        [],
      t.icon ?? this.icon,
    );
  }
  getKeyInputActionIds() {
    let t = new Set();
    return (
      this.keyInputs.forEach((r) => {
        if (r.keycode.startsWith("KA_")) {
          const i = r.keycode.replace("KA_", ""),
            n = parseInt(i);
          t.add(n);
        }
      }),
      t.values().toArray()
    );
  }
  static updateActionWithNewActionId(t, r, i) {
    let n = t.copy();
    return (
      (n.keyInputs = n.keyInputs.map(
        (s) => (s.keycode === r && (s.keycode = i), s),
      )),
      n
    );
  }
  static replaceAllStartingKeycode(t, r, i) {
    let n = t.copy();
    return (
      (n.keyInputs = n.keyInputs.map(
        (s) => (
          s.keycode.startsWith(r) && (s.keycode = s.keycode.replace(r, i)),
          s
        ),
      )),
      n
    );
  }
  static isActionAlreadyPresent(t, r) {
    for (let i = 0; i < r.length; i++) {
      const n = r[i];
      if (
        t.name === n.name &&
        t.color === n.color &&
        Be(t.keyInputs, n.keyInputs)
      )
        return n.id;
    }
  }
  static rehydrate(t) {
    var r;
    return new Je(
      t.id,
      t.name,
      t.color ?? void 0,
      (r = t.keyInputs) == null ? void 0 : r.map((i) => X.rehydrate(i)),
      t.icon,
    );
  }
  toDTO() {
    var t;
    try {
      return {
        ...super.toDTO(),
        keyInputs:
          (t = this.keyInputs) == null ? void 0 : t.map((r) => r.toDTO()),
      };
    } catch (r) {
      throw (console.error("|action| failed to serialize with error: " + r), r);
    }
  }
  toDeviceJson() {
    const t = this.keyInputs.map((r) => r.toDeviceJson());
    return { ...super.toDeviceJson(), actions: t };
  }
  static fromDTO(t) {
    var i;
    if (!t) throw new Error("Invalid JSON for Action");
    const r = ((i = t.keyInputs) == null
      ? void 0
      : i.map((n) => X.fromDTO(n))) ?? [new X()];
    return new Je(t.id, t.name, t.color, r, t.icon);
  }
  static fromDeviceJson(t) {
    var n;
    if (!t) throw new Error("Invalid JSON for Action");
    const r = ((n = t.actions) == null
        ? void 0
        : n.map((s) => X.fromDeviceAction(s))) ?? [new X()],
      i =
        t.color !== void 0 && t.color !== null
          ? `#${t.color.toString(16).toUpperCase().padStart(6, "0")}`
          : void 0;
    return new Je(t.id, t.name, i, r, t.icon);
  }
}
var Ir = Object.defineProperty,
  Ns = Object.getOwnPropertyDescriptor,
  Is = Object.getOwnPropertyNames,
  Ts = Object.prototype.hasOwnProperty,
  bs = (o, e) => {
    for (var t in e) Ir(o, t, { get: e[t], enumerable: !0 });
  },
  Os = (o, e, t, r) => {
    if ((e && typeof e == "object") || typeof e == "function")
      for (let i of Is(e))
        !Ts.call(o, i) &&
          i !== t &&
          Ir(o, i, {
            get: () => e[i],
            enumerable: !(r = Ns(e, i)) || r.enumerable,
          });
    return o;
  },
  Ks = (o) => Os(Ir({}, "__esModule", { value: !0 }), o),
  Xi = {};
bs(Xi, {
  ConnectionType: () => Yi,
  DeviceLayoutType: () => Zi,
  DeviceType: () => qi,
  LightingEffect: () => Qi,
  noopLogger: () => Fs,
});
var Ie = Ks(Xi),
  Yi = ((o) => ((o[(o.serial = 0)] = "serial"), (o[(o.hid = 1)] = "hid"), o))(
    Yi || {},
  ),
  qi = ((o) => (
    (o.NomadE = "nomad_e"),
    (o.NomadEV2 = "nomad_e_v2"),
    (o.Knob = "knob"),
    (o.KnobF1 = "knob_f1"),
    (o.CreatorMicroV2 = "creator_micro_v2"),
    (o.XYZ = "xyz"),
    (o.CodexMicro = "codex_micro"),
    (o.Bootloader = "bootloader"),
    o
  ))(qi || {}),
  Zi = ((o) => (
    (o.unknown = "unknown"),
    (o.ansi = "ansi"),
    (o.iso = "iso"),
    (o.universal = "universal"),
    o
  ))(Zi || {}),
  Ut = () => {},
  Fs = { info: Ut, error: Ut, debug: Ut, warn: Ut },
  Qi = ((o) => (
    (o.off = "off"),
    (o.solid = "solid"),
    (o.snake = "snake"),
    (o.rainbow = "rainbow"),
    (o.breath = "breath"),
    (o.gradient = "gradient"),
    o
  ))(Qi || {});
class le {
  constructor(e, t, r, i, n, s, l) {
    v(this, "portPath");
    v(this, "devicePid");
    v(this, "connectionType");
    v(this, "deviceType");
    v(this, "layoutType");
    v(this, "isUsbConnection");
    v(this, "fwVersion");
    ((this.portPath = e),
      (this.devicePid = t),
      (this.connectionType = r),
      (this.deviceType = i),
      (this.layoutType = n),
      (this.isUsbConnection = s),
      (this.fwVersion = l));
  }
  static rehydrate(e) {
    return new le(
      e.portPath,
      e.devicePid,
      e.connectionType,
      e.deviceType,
      e.layoutType,
      e.isUsbConnection,
      e.fwVersion,
    );
  }
  setFwVersion(e) {
    this.fwVersion = e;
  }
  copy(e = {}) {
    return new le(
      e.portPath ?? this.portPath,
      e.devicePid ?? this.devicePid,
      e.connectionType ?? this.connectionType,
      e.deviceType ?? this.deviceType,
      e.layoutType ?? this.layoutType,
      e.isUsbConnection ?? this.isUsbConnection,
      e.fwVersion ?? this.fwVersion,
    );
  }
  toDTO() {
    try {
      return {
        portPath: this.portPath,
        devicePid: this.devicePid,
        connectionType: this.connectionType,
        deviceType: this.deviceType,
        layoutType: this.layoutType,
        isUsbConnection: this.isUsbConnection,
      };
    } catch (e) {
      throw (console.error("|device| failed to serialize with error: " + e), e);
    }
  }
  static fromWLDevice(e) {
    return new le(
      e.portPath,
      e.devicePid,
      e.connectionType,
      e.deviceType,
      e.layoutType,
      e.isUsbConnection,
    );
  }
  static fromDTO(e) {
    if (!e)
      throw new Error("Invalid JSON: cannot create Device from undefined/null");
    return new le(
      e.portPath,
      e.devicePid,
      e.connectionType,
      e.deviceType,
      e.layoutType,
      e.isUsbConnection,
    );
  }
}
class vt {
  constructor(e, t, r, i, n, s, l) {
    v(this, "id");
    v(this, "name");
    v(this, "color");
    v(this, "layout");
    v(this, "os");
    v(this, "lights");
    v(this, "linkedAppId");
    ((this.id = e),
      (this.name = t),
      (this.color = r),
      (this.layout = i),
      (this.os = n),
      (this.lights = s),
      (this.linkedAppId = l));
  }
  getActionIdsInLayer(e, t) {
    var n, s, l, c, h;
    let r = new Set(),
      i = new Set();
    return (
      (n = this.layout.encoders) == null ||
        n.forEach((d) =>
          d.forEach((f) => {
            const _ = f;
            if (_.startsWith("KA_")) {
              const C = _.replace("KA_", ""),
                O = parseInt(C);
              r.add(O);
            } else if (_.startsWith("KA_")) {
              const C = _.replace("KM_", ""),
                O = parseInt(C);
              i.add(O);
            }
          }),
        ),
      (s = this.layout.buttons) == null ||
        s.forEach((d) =>
          d.forEach((f) => {
            const _ = f;
            if (_.startsWith("KA_")) {
              const C = _.replace("KA_", ""),
                O = parseInt(C);
              r.add(O);
            } else if (_.startsWith("KM_")) {
              const C = _.replace("KM_", ""),
                O = parseInt(C);
              i.add(O);
            }
          }),
        ),
      (l = this.layout.keymap) == null ||
        l.forEach((d) =>
          d.forEach((f) => {
            const _ = f;
            if (_.startsWith("KA_")) {
              const C = _.replace("KA_", ""),
                O = parseInt(C);
              r.add(O);
            } else if (_.startsWith("KM_")) {
              const C = _.replace("KM_", ""),
                O = parseInt(C);
              i.add(O);
            }
          }),
        ),
      (h = (c = this.layout.joystick) == null ? void 0 : c.sectors) == null ||
        h.forEach((d) => {
          const f = d.k;
          if (f.startsWith("KA_")) {
            const _ = f.replace("KA_", ""),
              C = parseInt(_);
            r.add(C);
          } else if (f.startsWith("KM_")) {
            const _ = f.replace("KM_", ""),
              C = parseInt(_);
            i.add(C);
          }
        }),
      i.forEach((d) => {
        const f = t.find((_) => _.id === d);
        f !== void 0 && f.getActionIds().forEach((_) => r.add(_));
      }),
      r.forEach((d) => {
        const f = e.find((_) => _.id === d);
        f !== void 0 && f.getKeyInputActionIds().forEach((_) => r.add(_));
      }),
      r.values().toArray()
    );
  }
  getMultiactionIdsInLayer(e) {
    var r, i, n, s;
    let t = new Set();
    return (
      (r = this.layout.encoders) == null ||
        r.forEach((l) =>
          l.forEach((c) => {
            const h = c;
            if (h.startsWith("KM_")) {
              const d = h.replace("KM_", ""),
                f = parseInt(d);
              t.add(f);
            }
          }),
        ),
      (i = this.layout.buttons) == null ||
        i.forEach((l) =>
          l.forEach((c) => {
            const h = c;
            if (h.startsWith("KM_")) {
              const d = h.replace("KM_", ""),
                f = parseInt(d);
              t.add(f);
            }
          }),
        ),
      this.layout.keymap.forEach((l) =>
        l.forEach((c) => {
          const h = c;
          if (h.startsWith("KM_")) {
            const d = h.replace("KM_", ""),
              f = parseInt(d);
            t.add(f);
          }
        }),
      ),
      (s = (n = this.layout.joystick) == null ? void 0 : n.sectors) == null ||
        s.forEach((l) => {
          const c = l.k;
          if (c.startsWith("KM_")) {
            const h = c.replace("KM_", ""),
              d = parseInt(h);
            t.add(d);
          }
        }),
      t.values().toArray()
    );
  }
  toDTO() {
    var e;
    try {
      const t = this.layout
        ? JSON.parse(JSON.stringify(this.layout))
        : { encoders: [], base: [] };
      return {
        id: this.id,
        name: this.name,
        color: this.color,
        layout: t,
        os: this.os,
        lights: (e = this.lights) == null ? void 0 : e.toDTO(),
        linkedAppId: this.linkedAppId,
      };
    } catch (t) {
      throw (console.error("|layer| failed to serialize with error: " + t), t);
    }
  }
  toDeviceJson() {
    var e, t, r, i, n;
    try {
      let s = this.layout;
      ((s.keymap = s.keymap.map((c) => c.map((h) => $e(h)))),
        (s.encoders =
          (e = s.encoders) == null
            ? void 0
            : e.map((c) => c.map((h) => $e(h)))),
        (s.buttons =
          (t = s.buttons) == null ? void 0 : t.map((c) => c.map((h) => $e(h)))),
        (r = s.joystick) != null &&
          r.sectors &&
          (s.joystick.sectors =
            (n = (i = s.joystick) == null ? void 0 : i.sectors) == null
              ? void 0
              : n.map((c) => ((c.k = $e(c.k)), c))));
      const l = s ? JSON.parse(JSON.stringify(s)) : { encoders: [], base: [] };
      return {
        id: this.id,
        name: this.name,
        color: Ji(this.color),
        layout: l,
        os: this.os,
        lights: this.lights ? Pe.rehydrate(this.lights).toDTO() : void 0,
        linkedAppId: this.linkedAppId,
      };
    } catch (s) {
      throw (
        console.error(
          "|layer| failed to convert to deviceJson with error: " + s,
        ),
        s
      );
    }
  }
  static fromDeviceJson(e) {
    try {
      const t = e.name,
        r = `#${e.color.toString(16).toUpperCase().padStart(6, "0")}`,
        i = e.layout,
        n = e.os,
        s = e.lights ? Pe.fromDTO(e.lights) : void 0,
        l = e.linkedAppId;
      return new vt(e.id, t, r, i, n, s, l);
    } catch (t) {
      throw (console.error(), t);
    }
  }
  static fromDTO(e) {
    try {
      const t = e.name,
        r = e.color,
        i = e.layout,
        n = e.os,
        s = e.lights ? Pe.fromDTO(e.lights) : void 0,
        l = e.linkedAppId;
      return new vt(e.id, t, r, i, n, s, l);
    } catch (t) {
      throw (console.error(), t);
    }
  }
}
class tt {
  constructor(e, t, r) {
    v(this, "id");
    v(this, "name");
    v(this, "layers");
    ((this.id = e), (this.name = t), (this.layers = r));
  }
  toDTO() {
    try {
      return {
        id: this.id,
        name: this.name,
        layers: this.layers.map((e) => e.toDTO()),
      };
    } catch (e) {
      throw (
        console.error("|profile| to DTO failed to serialize with error: " + e),
        e
      );
    }
  }
  toDeviceJson(e, t) {
    try {
      let r = new Set(),
        i = new Set();
      return (
        this.layers.forEach((n) => {
          (n.getActionIdsInLayer(e, t).forEach((s) => r.add(s)),
            n.getMultiactionIdsInLayer(t).forEach((s) => i.add(s)));
        }),
        {
          id: this.id,
          name: this.name,
          layers: this.layers.map((n) => n.toDeviceJson()),
          macrosUsed: r.values().toArray().sort(),
          multiActionsUsed: i.values().toArray().sort(),
        }
      );
    } catch (r) {
      throw (
        console.error(
          "|profile| toDeviceJson failed to serialize with error: " + r,
        ),
        r
      );
    }
  }
  static fromDeviceJson(e) {
    var t;
    try {
      const r =
        ((t = e.layers) == null
          ? void 0
          : t.map((i) => vt.fromDeviceJson(i))) ?? [];
      return new tt(e.id, e.name, r);
    } catch (r) {
      throw (console.error(r), r);
    }
  }
  static fromDTO(e) {
    var t;
    try {
      const r =
        ((t = e.layers) == null ? void 0 : t.map((i) => vt.fromDTO(i))) ?? [];
      return new tt(e.id, e.name, r);
    } catch (r) {
      throw (console.error(r), r);
    }
  }
}
class Te {
  constructor({ id: e, name: t, tags: r, color: i, actionIds: n }) {
    v(this, "id");
    v(this, "name");
    v(this, "tags");
    v(this, "color");
    v(this, "actionIds");
    ((this.id = e),
      (this.name = t),
      (this.tags = r),
      (this.color = i),
      (this.actionIds = n));
  }
  static rehydrate(e) {
    return new Te({
      id: e.id,
      name: e.name,
      tags: e.tags,
      color: e.color,
      actionIds: e.actionIds,
    });
  }
  static isGroupAlreadyPresent(e, t) {
    for (let r = 0; r < t.length; r++) {
      const i = t[r];
      if (
        e.name === i.name &&
        e.color === i.color &&
        Be(e.actionIds, i.actionIds)
      )
        return i.id;
    }
  }
  copy(e = {}) {
    return new Te({
      id: e.id ?? this.id,
      name: e.name ?? this.name,
      tags: e.tags ? [...e.tags] : this.tags ? [...this.tags] : void 0,
      color: e.color ?? this.color,
      actionIds: e.actionIds ? [...e.actionIds] : [...this.actionIds],
    });
  }
  toDTO() {
    try {
      return {
        id: this.id,
        name: this.name,
        tags: this.tags,
        color: this.color,
        actionIds: this.actionIds,
      };
    } catch (e) {
      throw (console.error("|group| failed to serialize with error: " + e), e);
    }
  }
  static fromDeviceJson(e) {
    if (!e) throw new Error("Invalid JSON for Group");
    return new Te({
      id: e.id,
      name: e.name,
      tags: e.tags,
      color: e.color,
      actionIds: e.actionIds ?? [],
    });
  }
  static fromDTO(e) {
    if (!e) throw new Error("Invalid JSON for Group");
    return new Te({
      id: e.id,
      name: e.name,
      tags: e.tags,
      color: e.color,
      actionIds: e.actionIds ?? [],
    });
  }
}
class ze extends rt {
  constructor(t, r = "My Multiaction", i, n, s, l, c, h = 250, d) {
    super(t, r, i, d);
    v(this, "tap");
    v(this, "onHold");
    v(this, "doubleTap");
    v(this, "tapHold");
    v(this, "tappingTerms", 250);
    ((this.tap = n ?? new X()),
      (this.onHold = s ?? new X()),
      (this.doubleTap = l ?? new X()),
      (this.tapHold = c ?? new X()),
      (this.tappingTerms = h));
  }
  copy(t = {}) {
    const r = (h) => {
        if (h === void 0) return new X();
        if (typeof h.copy == "function") return h.copy();
        const d = h;
        return new X(
          d.keycode ?? "KC_NONE",
          d.delay ?? 0,
          d.actionType ?? Nr.PRESS,
        );
      },
      i = t.tap !== void 0 ? r(t.tap) : this.tap.copy(),
      n = t.onHold !== void 0 ? r(t.onHold) : this.onHold.copy(),
      s = t.doubleTap !== void 0 ? r(t.doubleTap) : this.doubleTap.copy(),
      l = t.tapHold !== void 0 ? r(t.tapHold) : this.tapHold.copy(),
      c = t.tappingTerms !== void 0 ? t.tappingTerms : this.tappingTerms;
    return new ze(
      t.id ?? this.id,
      t.name ?? this.name,
      t.color ?? this.color ?? void 0,
      i,
      n,
      s,
      l,
      c,
      t.icon ?? this.icon,
    );
  }
  getActionIds() {
    let t = new Set();
    const r = this.tap.keycode;
    if (r.startsWith("KA_")) {
      const l = r.replace("KA_", ""),
        c = parseInt(l);
      t.add(c);
    }
    const i = this.onHold.keycode;
    if (i.startsWith("KA_")) {
      const l = i.replace("KA_", ""),
        c = parseInt(l);
      t.add(c);
    }
    const n = this.doubleTap.keycode;
    if (n.startsWith("KA_")) {
      const l = n.replace("KA_", ""),
        c = parseInt(l);
      t.add(c);
    }
    const s = this.tapHold.keycode;
    if (s.startsWith("KA_")) {
      const l = s.replace("KA_", ""),
        c = parseInt(l);
      t.add(c);
    }
    return t.values().toArray();
  }
  static isMultiactionAlreadyPresent(t, r) {
    for (let i = 0; i < r.length; i++) {
      const n = r[i];
      if (
        t.name === n.name &&
        t.color === n.color &&
        Be(t.tap, n.tap) &&
        Be(t.tapHold, n.tapHold) &&
        Be(t.onHold, n.onHold) &&
        Be(t.doubleTap, n.doubleTap)
      )
        return n.id;
    }
  }
  static updateMultiActionWithNewActionId(t, r, i) {
    let n = t.copy();
    return (
      n.tap.keycode === r && (n.tap.keycode = i),
      n.onHold.keycode === r && (n.onHold.keycode = i),
      n.doubleTap.keycode === r && (n.doubleTap.keycode = i),
      n.tapHold.keycode === r && (n.tapHold.keycode = i),
      n
    );
  }
  static replaceAllStartingKeycode(t, r, i) {
    let n = t.copy();
    return (
      n.tap.keycode.startsWith(r) &&
        (n.tap.keycode = n.tap.keycode.replace(r, i)),
      n.onHold.keycode.startsWith(r) &&
        (n.onHold.keycode = n.onHold.keycode.replace(r, i)),
      n.doubleTap.keycode.startsWith(r) &&
        (n.doubleTap.keycode = n.doubleTap.keycode.replace(r, i)),
      n.tapHold.keycode.startsWith(r) &&
        (n.tapHold.keycode = n.tapHold.keycode.replace(r, i)),
      n
    );
  }
  static rehydrate(t) {
    return new ze(
      t.id,
      t.name,
      t.color ?? void 0,
      X.rehydrate(t.tap),
      X.rehydrate(t.onHold),
      X.rehydrate(t.doubleTap),
      X.rehydrate(t.tapHold),
      t.tappingTerms,
      t.icon,
    );
  }
  toDTO() {
    var t, r, i, n;
    try {
      return {
        ...super.toDTO(),
        tap: (t = this.tap) == null ? void 0 : t.toDTO(),
        onHold: (r = this.onHold) == null ? void 0 : r.toDTO(),
        doubleTap: (i = this.doubleTap) == null ? void 0 : i.toDTO(),
        tapHold: (n = this.tapHold) == null ? void 0 : n.toDTO(),
        tappingTerms: this.tappingTerms,
      };
    } catch (s) {
      throw (
        console.error("|multiaction| failed to serialize with errror: " + s),
        s
      );
    }
  }
  toDeviceJson() {
    try {
      return {
        ...super.toDeviceJson(),
        kcOnTap: $e(this.tap.keycode),
        kcOnHold: $e(this.onHold.keycode),
        kcOnDoubleTap: $e(this.doubleTap.keycode),
        kcOnTapHold: $e(this.tapHold.keycode),
        icon: this.icon,
        tt: this.tappingTerms,
      };
    } catch (t) {
      throw (
        console.error("|multiaction| failed to serialize with errror: " + t),
        t
      );
    }
  }
  static fromDTO(t) {
    return new ze(
      t.id,
      t.name,
      t.color ?? void 0,
      X.fromDTO(t.tap),
      X.fromDTO(t.onHold),
      X.fromDTO(t.doubleTap),
      X.fromDTO(t.tapHold),
      t.tappingTerms,
      t.icon,
    );
  }
  static fromDeviceJson(t) {
    if (!t) throw new Error("Invalid JSON for MultiAction");
    const r =
      t.color !== void 0 && t.color !== null
        ? `#${t.color.toString(16).toUpperCase().padStart(6, "0")}`
        : void 0;
    return new ze(
      t.id,
      t.name,
      r,
      X.fromDeviceMultiaction(t.kcOnTap),
      X.fromDeviceMultiaction(t.kcOnHold),
      X.fromDeviceMultiaction(t.kcOnDoubleTap),
      X.fromDeviceMultiaction(t.kcOnTapHold),
      t.tt,
      t.icon,
    );
  }
}
class it {
  constructor({ id: e, name: t, process: r, path: i }) {
    v(this, "id");
    v(this, "name");
    v(this, "process");
    v(this, "path");
    ((this.id = e), (this.name = t), (this.process = r), (this.path = i));
  }
  copy(e = {}) {
    return new it({
      id: e.id ?? this.id,
      name: e.name ?? this.name,
      process: e.process ?? this.process,
      path: e.path ?? this.path,
    });
  }
  toDTO() {
    return {
      id: this.id,
      name: this.name,
      process: this.process,
      path: this.path,
    };
  }
  static fromDTO(e) {
    return new it({ id: e.id, name: e.name, process: e.process, path: e.path });
  }
  static rehydrate(e) {
    return new it({ id: e.id, name: e.name, process: e.process, path: e.path });
  }
}
var xe = ((o) => (
  (o.textStep = "TEXT_STEP"),
  (o.cmdStep = "CMD_STEP"),
  (o.appStep = "APP_STEP"),
  (o.urlStep = "URL_STEP"),
  o
))(xe || {});
class Re extends rt {
  constructor(t, r, i, n, s, l) {
    super(t, r, s, l);
    v(this, "type");
    v(this, "payload");
    ((this.type = i), (this.payload = n));
  }
  copy(t = {}) {
    return new Re(
      t.id ?? this.id,
      t.name ?? this.name,
      t.type ?? this.type,
      t.payload ?? this.payload,
      t.color ?? this.color ?? void 0,
      t.icon ?? this.icon,
    );
  }
  toDTO() {
    try {
      return { ...super.toDTO(), type: this.type, payload: this.payload };
    } catch (t) {
      throw (
        console.error("|smart_action| failed to serialize with error: " + t),
        t
      );
    }
  }
  static fromDTO(t) {
    if (!t) throw new Error("Invalid JSON for SmartAction");
    const r = t.type,
      i = Re.normalizeType(r),
      n = Re.normalizePayloadForType(i, t.payload);
    return new Re(t.id, t.name, i, n, t.color ?? void 0, t.icon);
  }
  static isSmartActionAlreadyPresent(t, r) {
    for (let i = 0; i < r.length; i++) {
      const n = r[i];
      if (
        t.name === n.name &&
        t.color === n.color &&
        t.type === n.type &&
        Be(t.payload, n.payload)
      )
        return n.id;
    }
  }
  static rehydrate(t) {
    return new Re(t.id, t.name, t.type, t.payload, t.color ?? void 0, t.icon);
  }
  static normalizeType(t) {
    return typeof t != "string"
      ? xe.textStep
      : Object.values(xe).includes(t)
        ? t
        : (console.warn(
            `|smart_action| unknown type "${t}", defaulting to textStep`,
          ),
          xe.textStep);
  }
  static normalizePayloadForType(t, r) {
    const i = r ?? {};
    switch (t) {
      case xe.textStep:
        return typeof i.text != "string"
          ? (console.warn(
              "|smart_action| textStep payload missing text, defaulting",
            ),
            { text: "" })
          : { text: i.text };
      case xe.cmdStep:
        return typeof i.cmd != "string"
          ? (console.warn(
              "|smart_action| cmdStep payload missing cmd, defaulting",
            ),
            { cmd: "" })
          : { cmd: i.cmd };
      case xe.urlStep:
        return typeof i.url != "string"
          ? (console.warn(
              "|smart_action| urlStep payload missing url, defaulting",
            ),
            { url: "" })
          : { url: i.url };
      case xe.appStep:
        return typeof i.name != "string" || typeof i.path != "string"
          ? (console.warn(
              "|smart_action| appStep payload missing name/path, defaulting",
            ),
            { name: "", path: "" })
          : { name: i.name, path: i.path };
      default:
        return { text: "" };
    }
  }
}
class Ge {
  constructor({
    deviceInfo: e,
    files: t,
    language: r,
    activeProfileId: i,
    profiles: n,
    actions: s,
    actionGroups: l,
    multiactions: c,
    multiactionGroups: h,
    deviceSpecificConfig: d,
    linkedApps: f,
    smartActions: _,
    smartActionGroups: C,
  }) {
    v(this, "deviceInfo");
    v(this, "files");
    v(this, "language");
    v(this, "activeProfileId");
    v(this, "profiles");
    v(this, "actions");
    v(this, "actionGroups");
    v(this, "multiactions");
    v(this, "multiactionGroups");
    v(this, "deviceSpecificConfig");
    v(this, "linkedApps");
    v(this, "smartActions");
    v(this, "smartActionGroups");
    ((this.deviceInfo = e),
      (this.files = t),
      (this.language = r),
      (this.activeProfileId = i),
      (this.profiles = n),
      (this.actions = s),
      (this.actionGroups = l),
      (this.multiactions = c),
      (this.multiactionGroups = h),
      (this.deviceSpecificConfig = d),
      (this.linkedApps = f),
      (this.smartActions = _),
      (this.smartActionGroups = C));
  }
  copy(e = {}) {
    const t = e.deviceInfo ?? this.deviceInfo,
      r = e.files ?? this.files,
      i = e.profiles ?? this.profiles,
      n = e.actions ?? this.actions,
      s = e.actionGroups ?? this.actionGroups,
      l = e.multiactions ?? this.multiactions,
      c = e.multiactionGroups ?? this.multiactionGroups,
      h = e.linkedApps ?? this.linkedApps,
      d = e.smartActions ?? this.smartActions,
      f = e.smartActionGroups ?? this.smartActionGroups;
    return new Ge({
      deviceInfo: t.copy(),
      files: r.map((_) => ({ ..._ })),
      language: e.language ?? this.language,
      activeProfileId: e.activeProfileId ?? this.activeProfileId,
      profiles: i.map((_) => tt.fromDTO(_.toDTO())),
      actions: n.map((_) => _.copy()),
      actionGroups: s.map((_) => _.copy()),
      multiactions: l.map((_) => _.copy()),
      multiactionGroups: c.map((_) => _.copy()),
      deviceSpecificConfig: e.deviceSpecificConfig ?? this.deviceSpecificConfig,
      linkedApps: h == null ? void 0 : h.map((_) => _.copy()),
      smartActions: d == null ? void 0 : d.map((_) => Re.fromDTO(_.toDTO())),
      smartActionGroups: f == null ? void 0 : f.map((_) => _.copy()),
    });
  }
  toDTO() {
    var e, t, r, i, n, s, l, c, h, d;
    try {
      return {
        device: (e = this.deviceInfo) == null ? void 0 : e.toDTO(),
        files:
          ((t = this.files) == null ? void 0 : t.map((f) => ({ ...f }))) ?? [],
        language: this.language,
        activeProfileId: this.activeProfileId,
        profiles:
          ((r = this.profiles) == null ? void 0 : r.map((f) => f.toDTO())) ??
          [],
        actions:
          ((i = this.actions) == null ? void 0 : i.map((f) => f.toDTO())) ?? [],
        actionGroups:
          ((n = this.actionGroups) == null
            ? void 0
            : n.map((f) => f.toDTO())) ?? [],
        multiactions:
          ((s = this.multiactions) == null
            ? void 0
            : s.map((f) => f.toDTO())) ?? [],
        multiactionGroups:
          ((l = this.multiactionGroups) == null
            ? void 0
            : l.map((f) => f.toDTO())) ?? [],
        deviceSpecificConfig: this.deviceSpecificConfig,
        linkedApps:
          ((c = this.linkedApps) == null ? void 0 : c.map((f) => f.toDTO())) ??
          [],
        smartActions:
          ((h = this.smartActions) == null
            ? void 0
            : h.map((f) => f.toDTO())) ?? [],
        smartActionGroups:
          ((d = this.smartActionGroups) == null
            ? void 0
            : d.map((f) => f.toDTO())) ?? [],
      };
    } catch (f) {
      throw (
        console.error("|device_config| failed to serialize with error: " + f),
        f
      );
    }
  }
  static fromDTO(e) {
    var t, r, i, n, s, l, c, h;
    return new Ge({
      deviceInfo: le.fromDTO(e.device),
      files: e.files ?? [],
      language: e.language,
      activeProfileId: e.activeProfileId,
      profiles:
        ((t = e.profiles) == null ? void 0 : t.map((d) => tt.fromDTO(d))) ?? [],
      actions:
        ((r = e.actions) == null ? void 0 : r.map((d) => Je.fromDTO(d))) ?? [],
      actionGroups:
        ((i = e.actionGroups) == null ? void 0 : i.map((d) => Te.fromDTO(d))) ??
        [],
      multiactions:
        ((n = e.multiactions) == null ? void 0 : n.map((d) => ze.fromDTO(d))) ??
        [],
      multiactionGroups:
        ((s = e.multiactionGroups) == null
          ? void 0
          : s.map((d) => Te.fromDTO(d))) ?? [],
      deviceSpecificConfig: e.deviceSpecificConfig,
      linkedApps:
        ((l = e.linkedApps) == null ? void 0 : l.map((d) => it.fromDTO(d))) ??
        [],
      smartActions:
        ((c = e.smartActions) == null ? void 0 : c.map((d) => Re.fromDTO(d))) ??
        [],
      smartActionGroups:
        ((h = e.smartActionGroups) == null
          ? void 0
          : h.map((d) => Te.fromDTO(d))) ?? [],
    });
  }
}
class Q extends Error {
  constructor(e = "Device not found") {
    (super(e), (this.name = "DeviceNotFoundError"));
  }
}
class As {
  constructor() {
    this.createHandlers();
  }
  createHandlers() {
    (p.info("Adding listeners for devices manager channel"),
      N.handle(we.connect, (e, t) => this.connect(t)),
      N.handle(we.disconnect, (e, t) => this.disconnect(t)),
      N.handle(we.isConnected, (e, t) => this.isConnected(t)),
      N.handle(we.getConnectedDevice, (e, t) => this.getConnectedDevice(t)),
      N.handle(we.getFileFetchStatus, (e, t, r) =>
        this.getFileFetchStatus(t, r),
      ),
      N.handle(we.changeDeviceConfig, (e, t, r) =>
        this.changeDeviceConfig(t, r),
      ),
      N.handle(we.abortRpcCall, (e, t, r) => this.abortRpcCall(t, r)),
      N.handle(we.clearCache, (e, t) => this.clearCache(t)),
      N.handle(we.deleteWallpaper, (e, t) => this.deleteWallpaper(t)),
      N.handle(we.addWallpaper, (e, t, r, i) => this.addWallpaper(t, r, i)),
      N.handle(we.getFwUpdateInfo, (e, t) => this.getFwUpdateInfo(t)),
      N.handle(we.getLatestFwRelease, (e, t, r) =>
        this.getLatestFwRelease(t, r),
      ),
      m.get().devicesCommManager.onConnectionEvent((e) => {
        m.get().windowService.sendDataToMainWin(we.onConnectionEvent, [
          e.deviceId,
          e.type === Le.CONNECTED,
        ]);
      }),
      m.get().devicesCommManager.onFileFetchEvent((e) => {
        m.get().windowService.sendDataToMainWin(we.onFileFetchEvent, [
          e.deviceId,
          e.fileName,
          e.fetchStatus,
        ]);
      }));
  }
  isConnected(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? Promise.resolve(t.isConnected()) : Promise.resolve(!1);
  }
  getFileFetchStatus(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r
      ? Promise.resolve(r.getFileFetchStatus(t))
      : Promise.reject(new Q());
  }
  getConnectedDevice(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? Promise.resolve(t.info) : Promise.resolve(void 0);
  }
  changeDeviceConfig(e, t) {
    const { devicesCommManager: r } = m.get(),
      i = r.getDevice(e);
    if (!i) return Promise.reject(new Q());
    const n = Ge.fromDTO(t);
    return new Promise((s, l) => {
      let c = !1;
      const h = (d) => {
        c || ((c = !0), s(d));
      };
      m.get()
        .deviceKeymapService.sendConfigData(i, n, h)
        .then((d) => {
          m.get().windowService.sendDataToMainWin(we.onChangeDeviceConfig, [
            e,
            d,
          ]);
        })
        .catch((d) => {
          (p.error(
            "|connected_device_channel| received error from keymap data: " + d,
          ),
            m
              .get()
              .windowService.sendDataToMainWin(we.onChangeDeviceConfig, [
                e,
                !1,
              ]),
            !c && ((c = !0), l(d)));
        });
    });
  }
  abortRpcCall(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r
      ? Promise.resolve(r.rpcService.abortRpcCall(t))
      : Promise.reject(new Q());
  }
  connect(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.connect() : Promise.reject(new Q());
  }
  disconnect(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.disconnect() : Promise.reject(new Q());
  }
  clearCache(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? Promise.resolve(t.clearCommQueue()) : Promise.reject(new Q());
  }
  deleteWallpaper(e) {
    return m.get().devicesCommManager.getDevice(e)
      ? m.get().deviceFileService.deleteWallpapers(e)
      : Promise.reject(new Q());
  }
  addWallpaper(e, t, r) {
    return m.get().devicesCommManager.getDevice(e)
      ? m.get().deviceFileService.addWallpaper(e, t, r)
      : Promise.reject(new Q());
  }
  getFwUpdateInfo(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? Promise.resolve(t.updateInfo) : Promise.reject(new Q());
  }
  getLatestFwRelease(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r
      ? m.get().deviceFlashService.getLatestFwRelease(r.info.deviceType, t)
      : Promise.reject(new Q());
  }
}
var Ae = ((o) => (
  (o.getDevices = "devsManGetDevs"),
  (o.searchDevices = "devsManSearchDevs"),
  (o.getBootloaderDevices = "devsManGetBootloaderDevs"),
  (o.onDevicesFound = "devsManOnDevicesFound"),
  (o.getLatestFwRelease = "devsManGetLatestFwRelease"),
  (o.onBootloaderDevicesFound = "devsManOnBlDevicesFound"),
  (o.onFlashingProgress = "devsManOnFlashingProgress"),
  (o.onFlashingLog = "devsManOnFlashingLog"),
  (o.flashFw = "devsManFlashFw"),
  o
))(Ae || {});
class sr extends le {
  constructor(t, r, i, n, s, l, c, h) {
    super(r, i, n, s, l, c);
    v(this, "id");
    v(this, "isConnected");
    ((this.id = t), (this.isConnected = h));
  }
  static fromDeviceInfo(t, r, i) {
    return new sr(
      t,
      i.portPath,
      i.devicePid,
      i.connectionType,
      i.deviceType,
      i.layoutType,
      i.isUsbConnection,
      r,
    );
  }
}
class Ms {
  constructor() {
    this.createHandlers();
  }
  createHandlers() {
    (p.info("Adding listeners for devices manager channel"),
      N.handle(Ae.searchDevices, this.searchDevices),
      N.handle(Ae.getDevices, this.getDevices),
      N.handle(Ae.getBootloaderDevices, this.getBootloaderDevices),
      N.handle(Ae.flashFw, (e, t, r) => this.flashFirmware(t, r)),
      N.handle(Ae.getLatestFwRelease, (e, t) => this.getLatestFwRelease(t)));
  }
  searchDevices() {
    return Promise.resolve(m.get().searchDevicesService.searchDevices());
  }
  getBootloaderDevices() {
    return Promise.resolve(m.get().searchDevicesService.getBootloaderDevices());
  }
  getDevices() {
    const e = m
      .get()
      .devicesCommManager.getDevices()
      .map((t) => {
        const r = t.isConnected();
        return new sr(
          t.id,
          t.info.portPath,
          t.info.devicePid,
          t.info.connectionType,
          t.info.deviceType,
          t.info.layoutType,
          t.info.isUsbConnection,
          r,
        );
      });
    return Promise.resolve(e);
  }
  flashFirmware(e, t) {
    return m.get().deviceFlashService.flashFirmware(e, t);
  }
  async getLatestFwRelease(e) {
    let t = !1;
    return (
      (await m.get().applicationService.appVersion()).includes("rc") &&
        (t = !0),
      m.get().deviceFlashService.getLatestFwRelease(e, t)
    );
  }
}
var me = ((o) => (
  (o.appVersion = "app-version"),
  (o.mainLog = "main-log"),
  (o.openDevTools = "open-dev-tools"),
  (o.enableMenuShortcuts = "enable-menu-shortcuts"),
  (o.disableMenuShortcuts = "disable-menu-shortcuts"),
  (o.openMacSettings = "open-mac-settings"),
  (o.openExternalTab = "open-external-tab"),
  (o.openFilePicker = "open-file-picker"),
  (o.getIsDevToolsOpen = "is-dev-tools-open"),
  (o.startFocusDetect = "start-focus-detect"),
  (o.sendAnalytics = "common-send-analytics"),
  (o.getAppSettings = "common-get-app-settings"),
  (o.sendAppSettings = "common-send-app-settings"),
  (o.onShortcutTriggered = "common-on-shortcut-triggered"),
  (o.checkAppPermissions = "common-check-app-permissions"),
  o
))(me || {});
class bt {
  constructor({
    showedAnalyticsPopUp: e,
    analyticsConsented: t,
    smartActionCmdEnabled: r,
  }) {
    v(this, "showedAnalyticsPopUp", !1);
    v(this, "analyticsConsented", !1);
    v(this, "smartActionCmdEnabled", !1);
    ((this.showedAnalyticsPopUp = e),
      (this.analyticsConsented = t),
      (this.smartActionCmdEnabled = r));
  }
  static fromDTO(e) {
    return new bt({
      analyticsConsented: e.analyticsConsented,
      showedAnalyticsPopUp: e.showedAnalyticsPopUp,
      smartActionCmdEnabled: e.smartActionCmdEnabled,
    });
  }
  toDTO() {
    return {
      showedAnalyticsPopUp: this.showedAnalyticsPopUp,
      analyticsConsented: this.analyticsConsented,
      smartActionCmdEnabled: this.smartActionCmdEnabled,
    };
  }
}
class Ps {
  constructor() {
    v(this, "platform");
    v(this, "onMainLog", () => () => {});
    ((this.platform = process.platform), this.createHandlers());
  }
  createHandlers() {
    (p.info("Adding listeners for devices manager channel"),
      N.handle(me.appVersion, (e) => this.appVersion()),
      N.handle(me.openMacSettings, this.openMacSettings),
      N.handle(me.openDevTools, (e) => this.openDevTools()),
      N.handle(me.enableMenuShortcuts, (e) => this.enableMenuShortcuts()),
      N.handle(me.disableMenuShortcuts, (e) => this.disableMenuShortcuts()),
      N.handle(me.openExternalTab, (e, t) => this.openExternalTab(t)),
      N.handle(me.openFilePicker, (e) => this.openFilePicker()),
      N.handle(me.getIsDevToolsOpen, (e) => this.getIsDevToolsOpen()),
      N.handle(me.startFocusDetect, (e) => this.startFocusDetect()),
      N.handle(me.sendAnalytics, (e, t) => this.sendAnalytics(t)),
      N.handle(me.getAppSettings, (e) => this.getAppSettings()),
      N.handle(me.sendAppSettings, (e, t) => this.saveAppSettings(t)),
      N.handle(me.checkAppPermissions, (e, t) => this.checkAppPermissions(t)));
  }
  async appVersion() {
    return m.get().applicationService.appVersion();
  }
  async openDevTools() {
    return m.get().windowService.openMainWinDevTools();
  }
  async openFilePicker() {
    return m.get().applicationService.openFilePicker();
  }
  enableMenuShortcuts() {
    return m.get().windowService.enableMenuShortcuts();
  }
  disableMenuShortcuts() {
    return m.get().windowService.disableMenuShortcuts();
  }
  openMacSettings() {
    return m.get().applicationService.openMacSettings();
  }
  openExternalTab(e) {
    return m.get().applicationService.openExternalTab(e);
  }
  getIsDevToolsOpen() {
    return Promise.resolve(m.get().windowService.isDevToolsOpen());
  }
  startFocusDetect() {
    return m.get().focusAppService.startAutodetect();
  }
  sendAnalytics(e) {
    m.get().analyticsService.sendAnalyticsEvent(e);
  }
  getAppSettings() {
    const e = m.get().applicationService.getAppSettings();
    return Promise.resolve(e.toDTO());
  }
  saveAppSettings(e) {
    const t = bt.fromDTO(e);
    return (
      m.get().applicationService.saveAppSettings(t),
      m.get().analyticsService.checkUserConsented(),
      Promise.resolve()
    );
  }
  checkAppPermissions(e) {
    return m.get().applicationService.checkAppPermissions(e);
  }
}
var Ze = ((o) => (
  (o.imageToLvgl = "image-channel-to-lvgl"),
  (o.lvglToImage = "image-channel-from-lvgl"),
  (o.accentFromImage = "image-channel-accent-from-image"),
  (o.getWallpaperImage = "image-channel-get-wallpaper-image"),
  (o.getGifFrameCount = "image-channel-get-gif-frame-count"),
  (o.cropGifImage = "image-channel-crop-gif"),
  o
))(Ze || {});
class Rs {
  constructor() {
    this.createHandlers();
  }
  createHandlers() {
    (N.handle(Ze.imageToLvgl, (e, t) => this.convertImageToLvglFormat(t)),
      N.handle(Ze.lvglToImage, (e, t) => this.convertImageFromLvglFormat(t)),
      N.handle(Ze.accentFromImage, (e, t) => this.getAccentColorFromImage(t)),
      N.handle(Ze.getWallpaperImage, (e, t, r) => this.getWallpaperImage(t, r)),
      N.handle(Ze.getGifFrameCount, (e, t) => this.getGifFrameCount(t)),
      N.handle(Ze.cropGifImage, (e, t, r, i, n, s, l, c, h) =>
        this.cropGifImage(t, r, i, n, s, l, c, h),
      ));
  }
  convertImageToLvglFormat(e) {
    return m.get().imageService.convertToLvglFormat(e);
  }
  convertImageFromLvglFormat(e) {
    return m.get().imageService.convertFromLvglFormat(e);
  }
  getAccentColorFromImage(e) {
    return m.get().imageService.accentForBlackBackground(Buffer.from(e));
  }
  getWallpaperImage(e, t) {
    return m.get().fsService.getWallpaperImage(e, t);
  }
  getGifFrameCount(e) {
    return m.get().imageService.getGifFrameCount(e);
  }
  cropGifImage(e, t, r, i, n, s, l, c) {
    return m.get().imageService.cropGifImage(e, t, r, i, n, s, l, c);
  }
}
var We = ((o) => (
  (o.downloadFile = "downloadFile"),
  (o.deleteFile = "deleteFile"),
  (o.saveBackupFile = "saveBackupFile"),
  (o.getBackupFiles = "getBackupFiles"),
  (o.deleteBackupFiles = "deleteBackupFiles"),
  (o.readFile = "readFile"),
  (o.selectApplication = "fsChannelSelectApplication"),
  (o.getApplications = "fsChannelGetApplications"),
  (o.openApplication = "fsChannelOpenApplication"),
  o
))(We || {});
class Ls {
  constructor() {
    this.createListeners();
  }
  createListeners() {
    (N.handle(We.downloadFile, (e, t) => this.downloadFile(t)),
      N.handle(We.deleteFile, (e, t) => this.deleteFile(t)),
      N.handle(We.saveBackupFile, (e, t, r) => this.saveBackupFile(t, r)),
      N.handle(We.getBackupFiles, (e) => this.getBackupFiles()),
      N.handle(We.deleteBackupFiles, (e) => this.deleteBackupFiles()),
      N.handle(We.readFile, (e, t) => this.readBinaryFile(t)),
      N.handle(We.getApplications, (e) => this.getApplications()),
      N.handle(We.openApplication, (e, t) => this.openApplication(t)));
  }
  async downloadFile(e) {
    return m.get().windowService.downloadTempFile(e);
  }
  async deleteFile(e) {
    return m.get().fsService.deleteFile(e);
  }
  async saveBackupFile(e, t) {
    return m.get().fsService.saveBackupFile(e, t);
  }
  async getBackupFiles() {
    return m.get().fsService.getBackupFiles();
  }
  async deleteBackupFiles() {
    return m.get().fsService.deleteBackupFiles();
  }
  async readBinaryFile(e) {
    return m.get().fsService.readBinaryFile(e);
  }
  getApplications() {
    return m.get().nativeService.getApplications();
  }
  openApplication(e) {
    return m.get().nativeService.openExternalApp(e);
  }
}
const $s = [
  {
    label: "input",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "quit", registerAccelerator: !1, accelerator: "" },
    ],
  },
  {
    label: "View",
    submenu: [
      {
        role: "resetZoom",
        enabled: !0,
        accelerator: "",
        registerAccelerator: !1,
      },
      { role: "zoomIn", enabled: !0, accelerator: "", registerAccelerator: !1 },
      {
        role: "zoomOut",
        enabled: !0,
        accelerator: "",
        registerAccelerator: !1,
      },
      { type: "separator", accelerator: "", registerAccelerator: !1 },
      { role: "togglefullscreen", accelerator: "", registerAccelerator: !1 },
    ],
  },
];
var kt = ((o) => ((o.UNDO = "UNDO"), (o.REDO = "REDO"), o))(kt || {});
const eo = [
    {
      label: z.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "close" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click(o, e, t) {
            var r;
            (p.debug("|enabled_menu| undo pressed"),
              (r = e == null ? void 0 : e.webContents) == null ||
                r.send(me.onShortcutTriggered, [kt.UNDO]));
          },
        },
        {
          label: "Redo",
          accelerator: "Shift+CmdOrCtrl+Z",
          click(o, e, t) {
            var r;
            (p.debug("|enabled_menu| redo pressed"),
              (r = e == null ? void 0 : e.webContents) == null ||
                r.send(me.onShortcutTriggered, [kt.REDO]));
          },
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        {
          label: "Zoom In",
          accelerator: process.platform === "darwin" ? "Command+=" : "Ctrl+=",
          click: (o, e) => {
            if (e instanceof Ve) {
              const t = e.webContents;
              t.setZoomLevel(t.getZoomLevel() + 1);
            }
          },
        },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      role: "help",
      submenu: [
        {
          label: "Download Logs",
          click: async () => {
            const o = m
                .get()
                .windowService.getWindowsLogs()
                .map(
                  ({ time: r, level: i, message: n }) =>
                    `"${r}"- ${i.toUpperCase()}- ${n}`,
                ).join(`
`),
              { filePath: e, canceled: t } = await wr.showSaveDialog({
                title: "Save Console Logs",
                defaultPath: "console-logs.txt",
                filters: [{ name: "Text Files", extensions: ["txt"] }],
              });
            !t && e && (await Li.writeFile(e, o, "utf8"));
          },
        },
        {
          label: "Send your feedback",
          click: () => {
            lt.openExternal("https://feedback.worklouder.cc/");
          },
        },
        {
          label: "Watch starting guide",
          click: () => {
            lt.openExternal("https://www.youtube.com/watch?v=p4RRbYg4eDc");
          },
        },
      ],
    },
  ],
  to = [
    {
      label: `${z.name} debug`,
      submenu: [
        { role: "about" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "close" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click(o, e, t) {
            var r;
            (p.debug("|debug_menu| undo pressed"),
              (r = e == null ? void 0 : e.webContents) == null ||
                r.send(me.onShortcutTriggered, [kt.UNDO]));
          },
        },
        {
          label: "Redo",
          accelerator: "Shift+CmdOrCtrl+Z",
          click(o, e, t) {
            var r;
            (p.debug("|debug_menu| redo pressed"),
              (r = e == null ? void 0 : e.webContents) == null ||
                r.send(me.onShortcutTriggered, [kt.REDO]));
          },
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        {
          label: "Zoom In",
          accelerator: process.platform === "darwin" ? "Command+=" : "Ctrl+=",
          click: (o, e) => {
            if (e instanceof Ve) {
              const t = e.webContents;
              t.setZoomLevel(t.getZoomLevel() + 1);
            }
          },
        },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      role: "help",
      submenu: [
        {
          label: "Download Logs",
          click: async () => {
            const o = m
                .get()
                .windowService.getWindowsLogs()
                .map(
                  ({ time: r, level: i, message: n }) =>
                    `"${r}"- ${i.toUpperCase()}- ${n}`,
                ).join(`
`),
              { filePath: e, canceled: t } = await wr.showSaveDialog({
                title: "Save Console Logs",
                defaultPath: "console-logs.txt",
                filters: [{ name: "Text Files", extensions: ["txt"] }],
              });
            !t && e && (await Li.writeFile(e, o, "utf8"));
          },
        },
        {
          label: "Give feedback",
          click: () => {
            lt.openExternal("https://feedback.worklouder.cc/");
          },
        },
        {
          label: "Watch starting guide",
          click: () => {
            lt.openExternal("https://www.youtube.com/watch?v=p4RRbYg4eDc");
          },
        },
      ],
    },
  ];
var Et = ((o) => (
    (o.onInitData = "radialMenuOnInitData"),
    (o.onMouseMove = "radialMenuOnMouseMove"),
    (o.onJoystickMove = "radialMenuOnJoystickMove"),
    (o.onHide = "radialMenuOnHide"),
    o
  ))(Et || {}),
  Vt = ((o) => (
    (o.firstVisit = "app_first_open"),
    (o.appStart = "app_start"),
    (o.windowOpen = "window_open"),
    (o.windowClose = "window_close"),
    (o.deviceSelected = "device_selected"),
    (o.deviceUnselected = "device_unselected"),
    (o.addWallpaper = "add_wallpaper"),
    (o.pageView = "page_view"),
    (o.advanceFlashOpen = "advance_flash_open"),
    (o.manualFlash = "manual_flash"),
    (o.resetSettings = "reset_settings"),
    (o.presetInstalled = "preset_installed"),
    (o.actionCreated = "action_created"),
    (o.multiactionCreated = "multiaction_created"),
    (o.actionEdited = "action_edited"),
    (o.multiactionEdited = "multiaction_edited"),
    (o.layerCreated = "layer_created"),
    (o.layerDeleted = "layer_deleted"),
    (o.layerImport = "layer_imported"),
    (o.layerExport = "layer_exported"),
    (o.profileCreated = "profile_created"),
    (o.profileDeleted = "profile_deleted"),
    (o.profileImport = "profile_imported"),
    (o.profileExport = "profile_export"),
    (o.deviceUpdated = "device_updated"),
    (o.bootloaderInstallClick = "bootloader_install_click"),
    (o.deviceUpdateError = "device_update_error"),
    o
  ))(Vt || {}),
  Dt = ((o) => (
    (o.onInitData = "cheatSheetOnInitData"),
    (o.onModeChange = "cheatSheetOnModeChange"),
    (o.reportWindowSize = "cheatSheetReportWindowSize"),
    (o.startDrag = "cheatSheetStartDrag"),
    (o.stopDrag = "cheatSheetStopDrag"),
    o
  ))(Dt || {}),
  Tr = ((o) => (
    (o[(o.basic = 0)] = "basic"),
    (o[(o.advanced = 1)] = "advanced"),
    o
  ))(Tr || {});
const ro = 5e3;
class xs {
  constructor() {
    v(this, "mainWin");
    v(this, "radialMenuWin");
    v(this, "cheatSheetWin");
    v(this, "radialMenuCursorTimer");
    v(this, "closeRadialTimer");
    v(this, "cheatSheetDragTimer");
    v(this, "cheatSheetDragOffset");
    v(this, "windowsLogs", []);
  }
  async loadWindow(e, t) {
    process.env.VITE_DEV_SERVER_URL
      ? await e.loadURL(`${process.env.VITE_DEV_SERVER_URL}${t}`)
      : await e.loadFile(ue(process.env.DIST, `${t}`));
  }
  async createMainWindow() {
    var i;
    const e = process.env.VITE_DEV_SERVER_URL,
      t = Fe.buildFromTemplate(eo);
    if (!e) Fe.setApplicationMenu(t);
    else {
      const n = Fe.buildFromTemplate(to);
      Fe.setApplicationMenu(n);
    }
    p.info("|window_service| Creating window");
    const r = ue(__dirname, "../preload/preload.mjs");
    if (
      ((this.mainWin = new Ve({
        title: "Work Louder - Input",
        icon: ue(
          process.env.VITE_PUBLIC,
          "assets",
          process.platform === "darwin" ? "icon.icns" : "icon.ico",
        ),
        webPreferences: { preload: r },
        show: !1,
        width: 1266,
        height: 793,
        minWidth: 1266,
        minHeight: 793,
        ...(process.platform === "darwin"
          ? { backgroundColor: "#000000" }
          : {}),
      })),
      !e)
    )
      this.mainWin.setMenu(t);
    else {
      const n = Fe.buildFromTemplate(to);
      this.mainWin.setMenu(n);
    }
    return (
      this.retrieveLogsFromWindow(this.mainWin),
      this.mainWin.webContents.on("destroyed", () => {
        var n;
        (m
          .get()
          .analyticsService.sendAnalyticsEvent({ event_type: Vt.windowClose }),
          (n = z.dock) == null || n.hide(),
          (this.mainWin = void 0));
      }),
      this.mainWin.once("ready-to-show", () => {
        var n, s;
        (e && ((n = this.mainWin) == null || n.webContents.openDevTools()),
          (s = this.mainWin) == null || s.show());
      }),
      this.loadWindow(this.mainWin, "index.html"),
      this.mainWin.webContents.setWindowOpenHandler(
        ({ url: n }) => (
          n.startsWith("https:") && lt.openExternal(n),
          { action: "deny" }
        ),
      ),
      (i = z.dock) == null || i.show(),
      m
        .get()
        .analyticsService.sendAnalyticsEvent({ event_type: Vt.windowOpen }),
      this.mainWin
    );
  }
  isMainWindowOpen() {
    return this.mainWin !== void 0;
  }
  getWindowsLogs() {
    return this.windowsLogs;
  }
  async createRadialMenuWindow() {
    var i;
    if (this.radialMenuWin !== void 0) {
      p.info("|window_service| radial window already exists");
      return;
    }
    p.info("|window_service| creating radial window");
    const e = ue(__dirname, "../preload/radial_menu_preload.mjs"),
      t = be.getCursorScreenPoint(),
      r = be.getDisplayNearestPoint(t);
    ((this.radialMenuWin = new Ve({
      x: r.bounds.x,
      y: r.bounds.y,
      width: r.bounds.width,
      height: r.bounds.height,
      frame: !1,
      transparent: !0,
      backgroundColor: "#00000000",
      movable: !1,
      resizable: !1,
      focusable: !1,
      alwaysOnTop: !1,
      skipTaskbar: !1,
      show: !1,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: { preload: e, backgroundThrottling: !0 },
    })),
      this.retrieveLogsFromWindow(this.radialMenuWin),
      process.platform === "darwin" &&
        ((i = this.radialMenuWin) == null ||
          i.setVisibleOnAllWorkspaces(!0, {
            visibleOnFullScreen: !0,
            skipTransformProcessType: !0,
          })),
      this.radialMenuWin.setHasShadow(!1),
      process.platform !== "win32" &&
        this.radialMenuWin.setIgnoreMouseEvents(!0, { forward: !0 }),
      this.loadWindow(this.radialMenuWin, "radial_menu.html"));
  }
  async showRadialMenu(e, t, r, i, n) {
    var s, l, c;
    if (
      (p.debug("|window_service| showing radial menu"),
      !(await this.sendInitDataToRadialMenu(e, t, r, i, n)))
    ) {
      p.info("|window_service| cannot send init info to radial menu");
      return;
    }
    try {
      this.handleRadialMenuCursorMovement();
    } catch {
      p.error("|window_service| error while sending initial cursor position");
    }
    ((this.radialMenuCursorTimer = setInterval(() => {
      try {
        this.handleRadialMenuCursorMovement();
      } catch {
        p.error("|window_service| error while sending cursor movement");
      }
    }, 16)),
      (s = this.radialMenuWin) == null || s.showInactive(),
      (l = this.radialMenuWin) == null || l.setAlwaysOnTop(!0, "pop-up-menu"),
      (c = this.radialMenuWin) == null ||
        c.setIgnoreMouseEvents(!0, { forward: !0 }),
      this.setCloseRadialTimer());
  }
  hideRadialMenu() {
    var e, t;
    (p.info("|window_service| hiding radial menu"),
      (e = this.radialMenuWin) == null || e.setIgnoreMouseEvents(!1),
      setTimeout(() => {
        var r;
        (r = this.radialMenuWin) == null || r.hide();
      }, 200),
      (t = this.radialMenuWin) == null || t.webContents.send(Et.onHide),
      this.radialMenuCursorTimer &&
        (clearInterval(this.radialMenuCursorTimer),
        (this.radialMenuCursorTimer = void 0)),
      this.closeRadialTimer &&
        (clearTimeout(this.closeRadialTimer),
        (this.closeRadialTimer = void 0)));
  }
  setCloseRadialTimer() {
    (this.closeRadialTimer &&
      (clearTimeout(this.closeRadialTimer), (this.closeRadialTimer = void 0)),
      (this.closeRadialTimer = setTimeout(() => {
        (p.info(
          "|window_service| too long has passed without a message hiding radial",
        ),
          this.hideRadialMenu());
      }, 3e3)));
  }
  onDestroy() {
    (this.closeCheatSheetWin(), this.closeRadialMenu());
  }
  clearRadialMenuTimer() {
    (clearInterval(this.radialMenuCursorTimer),
      (this.radialMenuCursorTimer = void 0),
      clearTimeout(this.closeRadialTimer),
      (this.closeRadialTimer = void 0));
  }
  async createCheatSheetWin(e, t, r, i) {
    var c;
    if (this.cheatSheetWin !== void 0) {
      p.info("|window_service| cheat-sheet window already exists");
      return;
    }
    p.info("|window_service| creating cheat-sheet window");
    const n = ue(__dirname, "../preload/cheat_sheet_preload.mjs"),
      s = be.getCursorScreenPoint(),
      l = be.getDisplayNearestPoint(s);
    ((this.cheatSheetWin = new Ve({
      x: -9999,
      y: -9999,
      width: l.bounds.width,
      height: l.bounds.height,
      frame: !1,
      transparent: !0,
      backgroundColor: "#00000000",
      movable: !1,
      resizable: !1,
      focusable: !1,
      alwaysOnTop: !1,
      skipTaskbar: !1,
      show: !1,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: { preload: n },
    })),
      this.retrieveLogsFromWindow(this.cheatSheetWin),
      this.cheatSheetWin.once("ready-to-show", async () => {
        if (!(await this.sendInitDataToCheatSheet(e, t, r, i))) {
          p.info("|window_service| cannot send init info to cheat-sheet");
          return;
        }
      }),
      process.platform === "darwin" &&
        ((c = this.cheatSheetWin) == null ||
          c.setVisibleOnAllWorkspaces(!0, {
            visibleOnFullScreen: !0,
            skipTransformProcessType: !0,
          })),
      this.cheatSheetWin.setHasShadow(!1),
      this.loadWindow(this.cheatSheetWin, "cheat_sheet.html"),
      m.get().cheatSheetChannel);
  }
  onCheatSheetWindowCreated(e, t) {
    if (!this.cheatSheetWin) return;
    const r = be.getCursorScreenPoint(),
      i = be.getDisplayNearestPoint(r),
      n = 16,
      s = i.workArea.x + n,
      l = i.workArea.y + i.workArea.height - t - n;
    (this.cheatSheetWin.setBounds({
      x: Math.round(s),
      y: Math.round(l),
      width: Math.round(e),
      height: Math.round(t),
    }),
      this.showCheatSheetWin());
  }
  async showCheatSheetWin() {
    var e, t;
    (p.debug("|window_service| showing cheat-sheet"),
      (e = this.cheatSheetWin) == null || e.showInactive(),
      (t = this.cheatSheetWin) == null || t.setAlwaysOnTop(!0, "floating"));
  }
  startCheatSheetDrag() {
    if (!this.cheatSheetWin) return;
    this.cheatSheetDragTimer &&
      (clearInterval(this.cheatSheetDragTimer),
      (this.cheatSheetDragTimer = void 0));
    const e = be.getCursorScreenPoint(),
      [t, r] = this.cheatSheetWin.getPosition();
    ((this.cheatSheetDragOffset = { x: e.x - t, y: e.y - r }),
      (this.cheatSheetDragTimer = setInterval(() => {
        try {
          if (!this.cheatSheetWin || !this.cheatSheetDragOffset) return;
          const { x: i, y: n } = be.getCursorScreenPoint();
          this.cheatSheetWin.setPosition(
            Math.round(i - this.cheatSheetDragOffset.x),
            Math.round(n - this.cheatSheetDragOffset.y),
          );
        } catch (i) {
          p.error(
            "|window_service| error while following cursor for cheat-sheet drag: " +
              i,
          );
        }
      }, 16)));
  }
  stopCheatSheetDrag() {
    (this.cheatSheetDragTimer &&
      (clearInterval(this.cheatSheetDragTimer),
      (this.cheatSheetDragTimer = void 0)),
      (this.cheatSheetDragOffset = void 0));
  }
  async sendInitDataToCheatSheet(e, t, r, i) {
    var c;
    const n = m.get().devicesCommManager.getDevice(e);
    if (!n) return (p.error("|window_service| device is null"), !1);
    const s = m.get().storageService.getDeviceConfig(n.info.devicePid);
    if (!s) return (p.error("|window_service| device data not saved"), !1);
    const l = { deviceConfig: s, profileIdx: t, layerIdx: r, mode: i };
    return (
      (c = this.cheatSheetWin) == null || c.webContents.send(Dt.onInitData, l),
      !0
    );
  }
  async closeCheatSheetWin() {
    var e;
    if (this.cheatSheetWin !== void 0)
      try {
        (p.info("|window_service| closing cheat-sheet window"),
          this.stopCheatSheetDrag(),
          (e = this.cheatSheetWin) == null || e.close(),
          (this.cheatSheetWin = void 0));
      } catch {
        p.error("|window_service| error while closing window");
      }
  }
  handleRadialMenuCursorMovement() {
    var c, h;
    if (!this.radialMenuWin) return;
    const { x: e, y: t } = be.getCursorScreenPoint(),
      r = be.getDisplayNearestPoint({ x: e, y: t }),
      i = this.radialMenuWin.getBounds(),
      n = be.getDisplayMatching(i);
    if (r.id !== n.id) {
      const d = r.workArea;
      (c = this.radialMenuWin) == null || c.setBounds(d);
    }
    const s = e - r.workArea.x,
      l = t - r.workArea.y;
    (h = this.radialMenuWin) == null ||
      h.webContents.send(Et.onMouseMove, { x: s, y: l });
  }
  async sendInitDataToRadialMenu(e, t, r, i, n) {
    var _, C, O, T, W, b, H, G;
    const s = m.get().devicesCommManager.getDevice(e);
    if (!s) return (p.error("|window_service| device is null"), !1);
    const l = m.get().storageService.getDeviceConfig(s.info.devicePid);
    if (!l) return (p.error("|window_service| device data not saved"), !1);
    const c = Ge.fromDTO(l),
      h =
        (b =
          (W =
            (T =
              (O =
                (C = (_ = c.profiles) == null ? void 0 : _[i]) == null
                  ? void 0
                  : C.layers) == null
                ? void 0
                : O[n]) == null
              ? void 0
              : T.layout) == null
            ? void 0
            : W.joystick) == null
          ? void 0
          : b.sectors;
    if (!h || h.length < 2)
      return (
        p.error(
          "|window_service| cannot find specific profile index: " +
            i +
            " and layer index: " +
            n +
            " combination",
        ),
        !1
      );
    const d = {
        joystickAngle: t,
        distanceFromCenter: r,
        actions: c.actions,
        multiactions: c.multiactions,
        smartActions:
          ((H = c.smartActions) == null ? void 0 : H.map((oe) => oe.toDTO())) ??
          [],
        sectors: h,
      },
      f = JSON.stringify(d);
    return (
      (G = this.radialMenuWin) == null || G.webContents.send(Et.onInitData, f),
      !0
    );
  }
  sendJoystickDataToRadialMenu(e, t, r) {
    var i;
    ((i = this.radialMenuWin) == null ||
      i.webContents.send(Et.onJoystickMove, {
        angle: e,
        distance: t,
        sectorActive: r,
      }),
      this.setCloseRadialTimer());
  }
  onRadialMenuNotify(e, t) {
    var h, d;
    p.debug("|window_service| onRadialMenuNotify called");
    const r =
        typeof (t == null ? void 0 : t.a) == "number" && Number.isFinite(t.a)
          ? t.a
          : void 0,
      i =
        typeof (t == null ? void 0 : t.d) == "number" && Number.isFinite(t.d)
          ? t.d
          : void 0,
      n = this.coerceNonNegativeInt(t == null ? void 0 : t.l),
      s = this.coerceNonNegativeInt(t == null ? void 0 : t.p),
      l = typeof (t == null ? void 0 : t.o) == "number" ? t.o : void 0;
    if (
      r === void 0 ||
      i === void 0 ||
      n === void 0 ||
      s === void 0 ||
      l === void 0
    ) {
      p.error(
        `|window_service| onRadialMenuNotify received invalid params: ${JSON.stringify(t)}`,
      );
      return;
    }
    if (
      (this.radialMenuWin === void 0 &&
        (p.debug("|window_service| radial win is closed reopening it"),
        this.createRadialMenuWindow()),
      l === 0)
    ) {
      (((h = this.radialMenuWin) == null ? void 0 : h.isVisible()) ?? !0) &&
        (p.debug(
          "|window_service| received hide operation from device hiding radial menu!",
        ),
        this.hideRadialMenu());
      return;
    }
    const c = l > 1 && typeof (t == null ? void 0 : t.s) == "number" ? t.s : -1;
    (((d = this.radialMenuWin) == null ? void 0 : d.isVisible()) ?? !1)
      ? this.sendJoystickDataToRadialMenu(r, i, c)
      : (p.debug(
          "|window_service| received show operation and radial menu is hidden, showing it!",
        ),
        this.showRadialMenu(e, r, i, s, n));
  }
  onCheatSheetNotify(e, t, r) {
    if (
      (p.debug("|window_service| onCheatSheetNotify called"),
      t === 0 || (this.cheatSheetWin && t === 2))
    ) {
      this.closeCheatSheetWin();
      return;
    }
    const i = this.coerceNonNegativeInt(r == null ? void 0 : r.layer),
      n = this.coerceNonNegativeInt(r == null ? void 0 : r.profile);
    if (i === void 0 || n === void 0) {
      p.error(
        `|window_service| onCheatSheetNotify received invalid layer/profile: ${JSON.stringify(r)}`,
      );
      return;
    }
    if (this.cheatSheetWin !== void 0) {
      this.sendInitDataToCheatSheet(e, n, i, Tr.advanced);
      return;
    }
    this.createCheatSheetWin(e, n, i, Tr.advanced);
  }
  coerceNonNegativeInt(e) {
    if (!(typeof e != "number" || !Number.isFinite(e) || e < 0))
      return Math.trunc(e);
  }
  async closeRadialMenu() {
    var e;
    if (this.radialMenuWin !== void 0)
      try {
        (p.info("|window_service| closing radial window"),
          (e = this.radialMenuWin) == null || e.close(),
          (this.radialMenuWin = void 0));
      } catch {
        p.error("|window_service| error while closing window");
      }
    this.clearRadialMenuTimer();
  }
  sendDataToMainWin(e, ...t) {
    var r;
    try {
      (r = this.mainWin) == null || r.webContents.send(e, t);
    } catch (i) {
      p.error(i);
    }
  }
  async openMainWinDevTools() {
    var e;
    (p.info("Opening dev tools"),
      (e = this.mainWin) == null || e.webContents.openDevTools());
  }
  enableMenuShortcuts() {
    var t;
    const e = Fe.buildFromTemplate(eo);
    return (
      Fe.setApplicationMenu(e),
      (t = this.mainWin) == null || t.setMenu(e),
      Promise.resolve()
    );
  }
  disableMenuShortcuts() {
    var t;
    p.info("Disabling menu shortcuts");
    const e = Fe.buildFromTemplate($s);
    return (
      Fe.setApplicationMenu(e),
      (t = this.mainWin) == null || t.setMenu(e),
      Promise.resolve()
    );
  }
  async downloadTempFile(e) {
    if (this.mainWin === void 0 || this.mainWin === null)
      return (
        p.error("Browser window is null"),
        Promise.reject("Cannot find window")
      );
    const t = z.getPath("temp");
    let r = "";
    try {
      r = (await ls(this.mainWin, e, { directory: t })).savePath;
    } catch (i) {
      i instanceof ds ? p.info("item.cancel() was called") : p.error(i);
    }
    return r;
  }
  isDevToolsOpen() {
    var e;
    return (
      ((e = this.mainWin) == null
        ? void 0
        : e.webContents.isDevToolsOpened()) ?? !1
    );
  }
  focusMainWindow() {
    var e;
    (e = this.mainWin) == null || e.focus();
  }
  retrieveLogsFromWindow(e) {
    try {
      e.webContents.on("console-message", (t, r, i, n, s) => {
        const l = ["debug", "info", "warn", "error"];
        this.pushWindowLog({
          level: l[r] ?? "info",
          message: i,
          time: new Date().toISOString(),
        });
      });
    } catch (t) {
      p.error(
        `|window_service| failed to retrive logs from window with error: ${t}`,
      );
      return;
    }
  }
  pushWindowLog(e) {
    (this.windowsLogs.push(e),
      this.windowsLogs.length > ro &&
        this.windowsLogs.splice(0, this.windowsLogs.length - ro));
  }
}
class Ws {
  constructor() {
    v(this, "appSettings");
  }
  async appVersion() {
    try {
      return (
        p.info("|application_service| getting app version"),
        z.getVersion()
      );
    } catch (e) {
      return (p.error("Error while getting app version", e), "");
    }
  }
  onThemeChange() {
    Ai.on("updated", () => {
      p.info("|application_service| OS theme changed");
    });
  }
  isDarkTheme() {
    return Ai.shouldUseDarkColors;
  }
  openExternalTab(e) {
    p.info("|application_service| opening external tab at url: ", e);
    try {
      const t = new URL(
        e.toLowerCase().startsWith("http") ? e : `https://${e}`,
      );
      return ["http:", "https:"].includes(t.protocol)
        ? lt.openExternal(t.toString())
        : (p.error("|application_service| protocol is not valid"),
          Promise.reject());
    } catch (t) {
      throw (p.error("|application_service| invalid URL:", e), t);
    }
  }
  openMacSettings() {
    return (
      p.info("|application_service| opening mac settings"),
      ps(
        'open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"',
      ),
      Promise.resolve()
    );
  }
  async openFilePicker() {
    const e = await wr.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Firmare", extensions: ["bin"] }],
    });
    if (!(e.filePaths.length <= 0)) return e.filePaths[0];
  }
  getAppSettings() {
    if (!this.appSettings) {
      const e = this.createNewSettings();
      return ((this.appSettings = e), e);
    }
    return this.appSettings;
  }
  saveAppSettings(e) {
    (m.get().storageService.saveAppSettings(e.toDTO()), (this.appSettings = e));
  }
  checkAppSettings() {
    const e = m.get().storageService.getAppSettings();
    if (!e) {
      const t = this.createNewSettings();
      this.appSettings = t;
      return;
    }
    try {
      this.appSettings = bt.fromDTO(e);
    } catch {
      (p.error("|application_service| cannot convert dto to app settings"),
        (this.appSettings = this.createNewSettings()));
    }
  }
  createNewSettings() {
    const e = new bt({
      showedAnalyticsPopUp: !1,
      analyticsConsented: !1,
      smartActionCmdEnabled: !1,
    });
    return (m.get().storageService.saveAppSettings(e.toDTO()), e);
  }
  checkAppPermissions(e) {
    try {
      return new os().check(e);
    } catch (t) {
      return (
        p.error(
          `|application_service| recevied error while checking permissions, error:${t}`,
        ),
        Promise.resolve(!1)
      );
    }
  }
}
var Bt = ((o) => (
    (o.checkUpdates = "check-updates"),
    (o.installUpdate = "install-update"),
    (o.onUpdateDownloaded = "on-update-downloaded"),
    o
  ))(Bt || {}),
  br = { exports: {} };
const js = "2.0.0",
  io = 256,
  Us = Number.MAX_SAFE_INTEGER || 9007199254740991,
  Vs = 16,
  Bs = io - 6,
  Gs = [
    "major",
    "premajor",
    "minor",
    "preminor",
    "patch",
    "prepatch",
    "prerelease",
  ];
var Gt = {
  MAX_LENGTH: io,
  MAX_SAFE_COMPONENT_LENGTH: Vs,
  MAX_SAFE_BUILD_LENGTH: Bs,
  MAX_SAFE_INTEGER: Us,
  RELEASE_TYPES: Gs,
  SEMVER_SPEC_VERSION: js,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2,
};
const Hs =
  typeof process == "object" &&
  process.env &&
  process.env.NODE_DEBUG &&
  /\bsemver\b/i.test(process.env.NODE_DEBUG)
    ? (...o) => console.error("SEMVER", ...o)
    : () => {};
var Ht = Hs;
(function (o, e) {
  const {
      MAX_SAFE_COMPONENT_LENGTH: t,
      MAX_SAFE_BUILD_LENGTH: r,
      MAX_LENGTH: i,
    } = Gt,
    n = Ht;
  e = o.exports = {};
  const s = (e.re = []),
    l = (e.safeRe = []),
    c = (e.src = []),
    h = (e.safeSrc = []),
    d = (e.t = {});
  let f = 0;
  const _ = "[a-zA-Z0-9-]",
    C = [
      ["\\s", 1],
      ["\\d", i],
      [_, r],
    ],
    O = (W) => {
      for (const [b, H] of C)
        W = W.split(`${b}*`)
          .join(`${b}{0,${H}}`)
          .split(`${b}+`)
          .join(`${b}{1,${H}}`);
      return W;
    },
    T = (W, b, H) => {
      const G = O(b),
        oe = f++;
      (n(W, oe, b),
        (d[W] = oe),
        (c[oe] = b),
        (h[oe] = G),
        (s[oe] = new RegExp(b, H ? "g" : void 0)),
        (l[oe] = new RegExp(G, H ? "g" : void 0)));
    };
  (T("NUMERICIDENTIFIER", "0|[1-9]\\d*"),
    T("NUMERICIDENTIFIERLOOSE", "\\d+"),
    T("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${_}*`),
    T(
      "MAINVERSION",
      `(${c[d.NUMERICIDENTIFIER]})\\.(${c[d.NUMERICIDENTIFIER]})\\.(${c[d.NUMERICIDENTIFIER]})`,
    ),
    T(
      "MAINVERSIONLOOSE",
      `(${c[d.NUMERICIDENTIFIERLOOSE]})\\.(${c[d.NUMERICIDENTIFIERLOOSE]})\\.(${c[d.NUMERICIDENTIFIERLOOSE]})`,
    ),
    T(
      "PRERELEASEIDENTIFIER",
      `(?:${c[d.NONNUMERICIDENTIFIER]}|${c[d.NUMERICIDENTIFIER]})`,
    ),
    T(
      "PRERELEASEIDENTIFIERLOOSE",
      `(?:${c[d.NONNUMERICIDENTIFIER]}|${c[d.NUMERICIDENTIFIERLOOSE]})`,
    ),
    T(
      "PRERELEASE",
      `(?:-(${c[d.PRERELEASEIDENTIFIER]}(?:\\.${c[d.PRERELEASEIDENTIFIER]})*))`,
    ),
    T(
      "PRERELEASELOOSE",
      `(?:-?(${c[d.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${c[d.PRERELEASEIDENTIFIERLOOSE]})*))`,
    ),
    T("BUILDIDENTIFIER", `${_}+`),
    T(
      "BUILD",
      `(?:\\+(${c[d.BUILDIDENTIFIER]}(?:\\.${c[d.BUILDIDENTIFIER]})*))`,
    ),
    T("FULLPLAIN", `v?${c[d.MAINVERSION]}${c[d.PRERELEASE]}?${c[d.BUILD]}?`),
    T("FULL", `^${c[d.FULLPLAIN]}$`),
    T(
      "LOOSEPLAIN",
      `[v=\\s]*${c[d.MAINVERSIONLOOSE]}${c[d.PRERELEASELOOSE]}?${c[d.BUILD]}?`,
    ),
    T("LOOSE", `^${c[d.LOOSEPLAIN]}$`),
    T("GTLT", "((?:<|>)?=?)"),
    T("XRANGEIDENTIFIERLOOSE", `${c[d.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`),
    T("XRANGEIDENTIFIER", `${c[d.NUMERICIDENTIFIER]}|x|X|\\*`),
    T(
      "XRANGEPLAIN",
      `[v=\\s]*(${c[d.XRANGEIDENTIFIER]})(?:\\.(${c[d.XRANGEIDENTIFIER]})(?:\\.(${c[d.XRANGEIDENTIFIER]})(?:${c[d.PRERELEASE]})?${c[d.BUILD]}?)?)?`,
    ),
    T(
      "XRANGEPLAINLOOSE",
      `[v=\\s]*(${c[d.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[d.XRANGEIDENTIFIERLOOSE]})(?:\\.(${c[d.XRANGEIDENTIFIERLOOSE]})(?:${c[d.PRERELEASELOOSE]})?${c[d.BUILD]}?)?)?`,
    ),
    T("XRANGE", `^${c[d.GTLT]}\\s*${c[d.XRANGEPLAIN]}$`),
    T("XRANGELOOSE", `^${c[d.GTLT]}\\s*${c[d.XRANGEPLAINLOOSE]}$`),
    T(
      "COERCEPLAIN",
      `(^|[^\\d])(\\d{1,${t}})(?:\\.(\\d{1,${t}}))?(?:\\.(\\d{1,${t}}))?`,
    ),
    T("COERCE", `${c[d.COERCEPLAIN]}(?:$|[^\\d])`),
    T(
      "COERCEFULL",
      c[d.COERCEPLAIN] +
        `(?:${c[d.PRERELEASE]})?(?:${c[d.BUILD]})?(?:$|[^\\d])`,
    ),
    T("COERCERTL", c[d.COERCE], !0),
    T("COERCERTLFULL", c[d.COERCEFULL], !0),
    T("LONETILDE", "(?:~>?)"),
    T("TILDETRIM", `(\\s*)${c[d.LONETILDE]}\\s+`, !0),
    (e.tildeTrimReplace = "$1~"),
    T("TILDE", `^${c[d.LONETILDE]}${c[d.XRANGEPLAIN]}$`),
    T("TILDELOOSE", `^${c[d.LONETILDE]}${c[d.XRANGEPLAINLOOSE]}$`),
    T("LONECARET", "(?:\\^)"),
    T("CARETTRIM", `(\\s*)${c[d.LONECARET]}\\s+`, !0),
    (e.caretTrimReplace = "$1^"),
    T("CARET", `^${c[d.LONECARET]}${c[d.XRANGEPLAIN]}$`),
    T("CARETLOOSE", `^${c[d.LONECARET]}${c[d.XRANGEPLAINLOOSE]}$`),
    T("COMPARATORLOOSE", `^${c[d.GTLT]}\\s*(${c[d.LOOSEPLAIN]})$|^$`),
    T("COMPARATOR", `^${c[d.GTLT]}\\s*(${c[d.FULLPLAIN]})$|^$`),
    T(
      "COMPARATORTRIM",
      `(\\s*)${c[d.GTLT]}\\s*(${c[d.LOOSEPLAIN]}|${c[d.XRANGEPLAIN]})`,
      !0,
    ),
    (e.comparatorTrimReplace = "$1$2$3"),
    T(
      "HYPHENRANGE",
      `^\\s*(${c[d.XRANGEPLAIN]})\\s+-\\s+(${c[d.XRANGEPLAIN]})\\s*$`,
    ),
    T(
      "HYPHENRANGELOOSE",
      `^\\s*(${c[d.XRANGEPLAINLOOSE]})\\s+-\\s+(${c[d.XRANGEPLAINLOOSE]})\\s*$`,
    ),
    T("STAR", "(<|>)?=?\\s*\\*"),
    T("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$"),
    T("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$"));
})(br, br.exports);
var Nt = br.exports;
const Js = Object.freeze({ loose: !0 }),
  zs = Object.freeze({}),
  Xs = (o) => (o ? (typeof o != "object" ? Js : o) : zs);
var Or = Xs;
const oo = /^[0-9]+$/,
  no = (o, e) => {
    if (typeof o == "number" && typeof e == "number")
      return o === e ? 0 : o < e ? -1 : 1;
    const t = oo.test(o),
      r = oo.test(e);
    return (
      t && r && ((o = +o), (e = +e)),
      o === e ? 0 : t && !r ? -1 : r && !t ? 1 : o < e ? -1 : 1
    );
  },
  Ys = (o, e) => no(e, o);
var so = { compareIdentifiers: no, rcompareIdentifiers: Ys };
const Jt = Ht,
  { MAX_LENGTH: ao, MAX_SAFE_INTEGER: zt } = Gt,
  { safeRe: Xt, t: Yt } = Nt,
  qs = Or,
  { compareIdentifiers: Kr } = so;
let Zs = class Me {
  constructor(e, t) {
    if (((t = qs(t)), e instanceof Me)) {
      if (
        e.loose === !!t.loose &&
        e.includePrerelease === !!t.includePrerelease
      )
        return e;
      e = e.version;
    } else if (typeof e != "string")
      throw new TypeError(
        `Invalid version. Must be a string. Got type "${typeof e}".`,
      );
    if (e.length > ao)
      throw new TypeError(`version is longer than ${ao} characters`);
    (Jt("SemVer", e, t),
      (this.options = t),
      (this.loose = !!t.loose),
      (this.includePrerelease = !!t.includePrerelease));
    const r = e.trim().match(t.loose ? Xt[Yt.LOOSE] : Xt[Yt.FULL]);
    if (!r) throw new TypeError(`Invalid Version: ${e}`);
    if (
      ((this.raw = e),
      (this.major = +r[1]),
      (this.minor = +r[2]),
      (this.patch = +r[3]),
      this.major > zt || this.major < 0)
    )
      throw new TypeError("Invalid major version");
    if (this.minor > zt || this.minor < 0)
      throw new TypeError("Invalid minor version");
    if (this.patch > zt || this.patch < 0)
      throw new TypeError("Invalid patch version");
    (r[4]
      ? (this.prerelease = r[4].split(".").map((i) => {
          if (/^[0-9]+$/.test(i)) {
            const n = +i;
            if (n >= 0 && n < zt) return n;
          }
          return i;
        }))
      : (this.prerelease = []),
      (this.build = r[5] ? r[5].split(".") : []),
      this.format());
  }
  format() {
    return (
      (this.version = `${this.major}.${this.minor}.${this.patch}`),
      this.prerelease.length &&
        (this.version += `-${this.prerelease.join(".")}`),
      this.version
    );
  }
  toString() {
    return this.version;
  }
  compare(e) {
    if (
      (Jt("SemVer.compare", this.version, this.options, e), !(e instanceof Me))
    ) {
      if (typeof e == "string" && e === this.version) return 0;
      e = new Me(e, this.options);
    }
    return e.version === this.version
      ? 0
      : this.compareMain(e) || this.comparePre(e);
  }
  compareMain(e) {
    return (
      e instanceof Me || (e = new Me(e, this.options)),
      this.major < e.major
        ? -1
        : this.major > e.major
          ? 1
          : this.minor < e.minor
            ? -1
            : this.minor > e.minor
              ? 1
              : this.patch < e.patch
                ? -1
                : this.patch > e.patch
                  ? 1
                  : 0
    );
  }
  comparePre(e) {
    if (
      (e instanceof Me || (e = new Me(e, this.options)),
      this.prerelease.length && !e.prerelease.length)
    )
      return -1;
    if (!this.prerelease.length && e.prerelease.length) return 1;
    if (!this.prerelease.length && !e.prerelease.length) return 0;
    let t = 0;
    do {
      const r = this.prerelease[t],
        i = e.prerelease[t];
      if ((Jt("prerelease compare", t, r, i), r === void 0 && i === void 0))
        return 0;
      if (i === void 0) return 1;
      if (r === void 0) return -1;
      if (r !== i) return Kr(r, i);
    } while (++t);
  }
  compareBuild(e) {
    e instanceof Me || (e = new Me(e, this.options));
    let t = 0;
    do {
      const r = this.build[t],
        i = e.build[t];
      if ((Jt("build compare", t, r, i), r === void 0 && i === void 0))
        return 0;
      if (i === void 0) return 1;
      if (r === void 0) return -1;
      if (r !== i) return Kr(r, i);
    } while (++t);
  }
  inc(e, t, r) {
    if (e.startsWith("pre")) {
      if (!t && r === !1)
        throw new Error("invalid increment argument: identifier is empty");
      if (t) {
        const i = `-${t}`.match(
          this.options.loose ? Xt[Yt.PRERELEASELOOSE] : Xt[Yt.PRERELEASE],
        );
        if (!i || i[1] !== t) throw new Error(`invalid identifier: ${t}`);
      }
    }
    switch (e) {
      case "premajor":
        ((this.prerelease.length = 0),
          (this.patch = 0),
          (this.minor = 0),
          this.major++,
          this.inc("pre", t, r));
        break;
      case "preminor":
        ((this.prerelease.length = 0),
          (this.patch = 0),
          this.minor++,
          this.inc("pre", t, r));
        break;
      case "prepatch":
        ((this.prerelease.length = 0),
          this.inc("patch", t, r),
          this.inc("pre", t, r));
        break;
      case "prerelease":
        (this.prerelease.length === 0 && this.inc("patch", t, r),
          this.inc("pre", t, r));
        break;
      case "release":
        if (this.prerelease.length === 0)
          throw new Error(`version ${this.raw} is not a prerelease`);
        this.prerelease.length = 0;
        break;
      case "major":
        ((this.minor !== 0 ||
          this.patch !== 0 ||
          this.prerelease.length === 0) &&
          this.major++,
          (this.minor = 0),
          (this.patch = 0),
          (this.prerelease = []));
        break;
      case "minor":
        ((this.patch !== 0 || this.prerelease.length === 0) && this.minor++,
          (this.patch = 0),
          (this.prerelease = []));
        break;
      case "patch":
        (this.prerelease.length === 0 && this.patch++, (this.prerelease = []));
        break;
      case "pre": {
        const i = Number(r) ? 1 : 0;
        if (this.prerelease.length === 0) this.prerelease = [i];
        else {
          let n = this.prerelease.length;
          for (; --n >= 0; )
            typeof this.prerelease[n] == "number" &&
              (this.prerelease[n]++, (n = -2));
          if (n === -1) {
            if (t === this.prerelease.join(".") && r === !1)
              throw new Error(
                "invalid increment argument: identifier already exists",
              );
            this.prerelease.push(i);
          }
        }
        if (t) {
          let n = [t, i];
          (r === !1 && (n = [t]),
            Kr(this.prerelease[0], t) === 0
              ? isNaN(this.prerelease[1]) && (this.prerelease = n)
              : (this.prerelease = n));
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${e}`);
    }
    return (
      (this.raw = this.format()),
      this.build.length && (this.raw += `+${this.build.join(".")}`),
      this
    );
  }
};
var Ee = Zs;
const co = Ee,
  Qs = (o, e, t = !1) => {
    if (o instanceof co) return o;
    try {
      return new co(o, e);
    } catch (r) {
      if (!t) return null;
      throw r;
    }
  };
var dt = Qs;
const ea = dt,
  ta = (o, e) => {
    const t = ea(o, e);
    return t ? t.version : null;
  };
var ra = ta;
const ia = dt,
  oa = (o, e) => {
    const t = ia(o.trim().replace(/^[=v]+/, ""), e);
    return t ? t.version : null;
  };
var na = oa;
const lo = Ee,
  sa = (o, e, t, r, i) => {
    typeof t == "string" && ((i = r), (r = t), (t = void 0));
    try {
      return new lo(o instanceof lo ? o.version : o, t).inc(e, r, i).version;
    } catch {
      return null;
    }
  };
var aa = sa;
const po = dt,
  ca = (o, e) => {
    const t = po(o, null, !0),
      r = po(e, null, !0),
      i = t.compare(r);
    if (i === 0) return null;
    const n = i > 0,
      s = n ? t : r,
      l = n ? r : t,
      c = !!s.prerelease.length;
    if (l.prerelease.length && !c) {
      if (!l.patch && !l.minor) return "major";
      if (l.compareMain(s) === 0)
        return l.minor && !l.patch ? "minor" : "patch";
    }
    const h = c ? "pre" : "";
    return t.major !== r.major
      ? h + "major"
      : t.minor !== r.minor
        ? h + "minor"
        : t.patch !== r.patch
          ? h + "patch"
          : "prerelease";
  };
var la = ca;
const da = Ee,
  pa = (o, e) => new da(o, e).major;
var ha = pa;
const ua = Ee,
  fa = (o, e) => new ua(o, e).minor;
var ma = fa;
const va = Ee,
  ga = (o, e) => new va(o, e).patch;
var ya = ga;
const _a = dt,
  wa = (o, e) => {
    const t = _a(o, e);
    return t && t.prerelease.length ? t.prerelease : null;
  };
var Ca = wa;
const ho = Ee,
  Sa = (o, e, t) => new ho(o, t).compare(new ho(e, t));
var Oe = Sa;
const ka = Oe,
  Ea = (o, e, t) => ka(e, o, t);
var Da = Ea;
const Na = Oe,
  Ia = (o, e) => Na(o, e, !0);
var Ta = Ia;
const uo = Ee,
  ba = (o, e, t) => {
    const r = new uo(o, t),
      i = new uo(e, t);
    return r.compare(i) || r.compareBuild(i);
  };
var Fr = ba;
const Oa = Fr,
  Ka = (o, e) => o.sort((t, r) => Oa(t, r, e));
var Fa = Ka;
const Aa = Fr,
  Ma = (o, e) => o.sort((t, r) => Aa(r, t, e));
var Pa = Ma;
const Ra = Oe,
  La = (o, e, t) => Ra(o, e, t) > 0;
var qt = La;
const $a = Oe,
  xa = (o, e, t) => $a(o, e, t) < 0;
var Ar = xa;
const Wa = Oe,
  ja = (o, e, t) => Wa(o, e, t) === 0;
var fo = ja;
const Ua = Oe,
  Va = (o, e, t) => Ua(o, e, t) !== 0;
var mo = Va;
const Ba = Oe,
  Ga = (o, e, t) => Ba(o, e, t) >= 0;
var Mr = Ga;
const Ha = Oe,
  Ja = (o, e, t) => Ha(o, e, t) <= 0;
var Pr = Ja;
const za = fo,
  Xa = mo,
  Ya = qt,
  qa = Mr,
  Za = Ar,
  Qa = Pr,
  ec = (o, e, t, r) => {
    switch (e) {
      case "===":
        return (
          typeof o == "object" && (o = o.version),
          typeof t == "object" && (t = t.version),
          o === t
        );
      case "!==":
        return (
          typeof o == "object" && (o = o.version),
          typeof t == "object" && (t = t.version),
          o !== t
        );
      case "":
      case "=":
      case "==":
        return za(o, t, r);
      case "!=":
        return Xa(o, t, r);
      case ">":
        return Ya(o, t, r);
      case ">=":
        return qa(o, t, r);
      case "<":
        return Za(o, t, r);
      case "<=":
        return Qa(o, t, r);
      default:
        throw new TypeError(`Invalid operator: ${e}`);
    }
  };
var vo = ec;
const tc = Ee,
  rc = dt,
  { safeRe: Zt, t: Qt } = Nt,
  ic = (o, e) => {
    if (o instanceof tc) return o;
    if ((typeof o == "number" && (o = String(o)), typeof o != "string"))
      return null;
    e = e || {};
    let t = null;
    if (!e.rtl)
      t = o.match(e.includePrerelease ? Zt[Qt.COERCEFULL] : Zt[Qt.COERCE]);
    else {
      const c = e.includePrerelease ? Zt[Qt.COERCERTLFULL] : Zt[Qt.COERCERTL];
      let h;
      for (; (h = c.exec(o)) && (!t || t.index + t[0].length !== o.length); )
        ((!t || h.index + h[0].length !== t.index + t[0].length) && (t = h),
          (c.lastIndex = h.index + h[1].length + h[2].length));
      c.lastIndex = -1;
    }
    if (t === null) return null;
    const r = t[2],
      i = t[3] || "0",
      n = t[4] || "0",
      s = e.includePrerelease && t[5] ? `-${t[5]}` : "",
      l = e.includePrerelease && t[6] ? `+${t[6]}` : "";
    return rc(`${r}.${i}.${n}${s}${l}`, e);
  };
var oc = ic;
class nc {
  constructor() {
    ((this.max = 1e3), (this.map = new Map()));
  }
  get(e) {
    const t = this.map.get(e);
    if (t !== void 0) return (this.map.delete(e), this.map.set(e, t), t);
  }
  delete(e) {
    return this.map.delete(e);
  }
  set(e, t) {
    if (!this.delete(e) && t !== void 0) {
      if (this.map.size >= this.max) {
        const r = this.map.keys().next().value;
        this.delete(r);
      }
      this.map.set(e, t);
    }
    return this;
  }
}
var sc = nc,
  Rr,
  go;
function Ke() {
  if (go) return Rr;
  go = 1;
  const o = /\s+/g;
  class e {
    constructor(E, A) {
      if (((A = i(A)), E instanceof e))
        return E.loose === !!A.loose &&
          E.includePrerelease === !!A.includePrerelease
          ? E
          : new e(E.raw, A);
      if (E instanceof n)
        return (
          (this.raw = E.value),
          (this.set = [[E]]),
          (this.formatted = void 0),
          this
        );
      if (
        ((this.options = A),
        (this.loose = !!A.loose),
        (this.includePrerelease = !!A.includePrerelease),
        (this.raw = E.trim().replace(o, " ")),
        (this.set = this.raw
          .split("||")
          .map((k) => this.parseRange(k.trim()))
          .filter((k) => k.length)),
        !this.set.length)
      )
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      if (this.set.length > 1) {
        const k = this.set[0];
        if (
          ((this.set = this.set.filter((R) => !T(R[0]))), this.set.length === 0)
        )
          this.set = [k];
        else if (this.set.length > 1) {
          for (const R of this.set)
            if (R.length === 1 && W(R[0])) {
              this.set = [R];
              break;
            }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let E = 0; E < this.set.length; E++) {
          E > 0 && (this.formatted += "||");
          const A = this.set[E];
          for (let k = 0; k < A.length; k++)
            (k > 0 && (this.formatted += " "),
              (this.formatted += A[k].toString().trim()));
        }
      }
      return this.formatted;
    }
    format() {
      return this.range;
    }
    toString() {
      return this.range;
    }
    parseRange(E) {
      const A =
          ((this.options.includePrerelease && C) | (this.options.loose && O)) +
          ":" +
          E,
        k = r.get(A);
      if (k) return k;
      const R = this.options.loose,
        P = R ? c[h.HYPHENRANGELOOSE] : c[h.HYPHENRANGE];
      ((E = E.replace(P, nt(this.options.includePrerelease))),
        s("hyphen replace", E),
        (E = E.replace(c[h.COMPARATORTRIM], d)),
        s("comparator trim", E),
        (E = E.replace(c[h.TILDETRIM], f)),
        s("tilde trim", E),
        (E = E.replace(c[h.CARETTRIM], _)),
        s("caret trim", E));
      let $ = E.split(" ")
        .map((M) => H(M, this.options))
        .join(" ")
        .split(/\s+/)
        .map((M) => gt(M, this.options));
      (R &&
        ($ = $.filter(
          (M) => (
            s("loose invalid filter", M, this.options),
            !!M.match(c[h.COMPARATORLOOSE])
          ),
        )),
        s("range list", $));
      const g = new Map(),
        S = $.map((M) => new n(M, this.options));
      for (const M of S) {
        if (T(M)) return [M];
        g.set(M.value, M);
      }
      g.size > 1 && g.has("") && g.delete("");
      const F = [...g.values()];
      return (r.set(A, F), F);
    }
    intersects(E, A) {
      if (!(E instanceof e)) throw new TypeError("a Range is required");
      return this.set.some(
        (k) =>
          b(k, A) &&
          E.set.some(
            (R) =>
              b(R, A) && k.every((P) => R.every(($) => P.intersects($, A))),
          ),
      );
    }
    test(E) {
      if (!E) return !1;
      if (typeof E == "string")
        try {
          E = new l(E, this.options);
        } catch {
          return !1;
        }
      for (let A = 0; A < this.set.length; A++)
        if (Ye(this.set[A], E, this.options)) return !0;
      return !1;
    }
  }
  Rr = e;
  const t = sc,
    r = new t(),
    i = Or,
    n = er(),
    s = Ht,
    l = Ee,
    {
      safeRe: c,
      t: h,
      comparatorTrimReplace: d,
      tildeTrimReplace: f,
      caretTrimReplace: _,
    } = Nt,
    { FLAG_INCLUDE_PRERELEASE: C, FLAG_LOOSE: O } = Gt,
    T = (I) => I.value === "<0.0.0-0",
    W = (I) => I.value === "",
    b = (I, E) => {
      let A = !0;
      const k = I.slice();
      let R = k.pop();
      for (; A && k.length; )
        ((A = k.every((P) => R.intersects(P, E))), (R = k.pop()));
      return A;
    },
    H = (I, E) => (
      (I = I.replace(c[h.BUILD], "")),
      s("comp", I, E),
      (I = ge(I, E)),
      s("caret", I),
      (I = oe(I, E)),
      s("tildes", I),
      (I = Ce(I, E)),
      s("xrange", I),
      (I = Xe(I, E)),
      s("stars", I),
      I
    ),
    G = (I) => !I || I.toLowerCase() === "x" || I === "*",
    oe = (I, E) =>
      I.trim()
        .split(/\s+/)
        .map((A) => ne(A, E))
        .join(" "),
    ne = (I, E) => {
      const A = E.loose ? c[h.TILDELOOSE] : c[h.TILDE];
      return I.replace(A, (k, R, P, $, g) => {
        s("tilde", I, k, R, P, $, g);
        let S;
        return (
          G(R)
            ? (S = "")
            : G(P)
              ? (S = `>=${R}.0.0 <${+R + 1}.0.0-0`)
              : G($)
                ? (S = `>=${R}.${P}.0 <${R}.${+P + 1}.0-0`)
                : g
                  ? (s("replaceTilde pr", g),
                    (S = `>=${R}.${P}.${$}-${g} <${R}.${+P + 1}.0-0`))
                  : (S = `>=${R}.${P}.${$} <${R}.${+P + 1}.0-0`),
          s("tilde return", S),
          S
        );
      });
    },
    ge = (I, E) =>
      I.trim()
        .split(/\s+/)
        .map((A) => de(A, E))
        .join(" "),
    de = (I, E) => {
      s("caret", I, E);
      const A = E.loose ? c[h.CARETLOOSE] : c[h.CARET],
        k = E.includePrerelease ? "-0" : "";
      return I.replace(A, (R, P, $, g, S) => {
        s("caret", I, R, P, $, g, S);
        let F;
        return (
          G(P)
            ? (F = "")
            : G($)
              ? (F = `>=${P}.0.0${k} <${+P + 1}.0.0-0`)
              : G(g)
                ? P === "0"
                  ? (F = `>=${P}.${$}.0${k} <${P}.${+$ + 1}.0-0`)
                  : (F = `>=${P}.${$}.0${k} <${+P + 1}.0.0-0`)
                : S
                  ? (s("replaceCaret pr", S),
                    P === "0"
                      ? $ === "0"
                        ? (F = `>=${P}.${$}.${g}-${S} <${P}.${$}.${+g + 1}-0`)
                        : (F = `>=${P}.${$}.${g}-${S} <${P}.${+$ + 1}.0-0`)
                      : (F = `>=${P}.${$}.${g}-${S} <${+P + 1}.0.0-0`))
                  : (s("no pr"),
                    P === "0"
                      ? $ === "0"
                        ? (F = `>=${P}.${$}.${g}${k} <${P}.${$}.${+g + 1}-0`)
                        : (F = `>=${P}.${$}.${g}${k} <${P}.${+$ + 1}.0-0`)
                      : (F = `>=${P}.${$}.${g} <${+P + 1}.0.0-0`)),
          s("caret return", F),
          F
        );
      });
    },
    Ce = (I, E) => (
      s("replaceXRanges", I, E),
      I.split(/\s+/)
        .map((A) => ot(A, E))
        .join(" ")
    ),
    ot = (I, E) => {
      I = I.trim();
      const A = E.loose ? c[h.XRANGELOOSE] : c[h.XRANGE];
      return I.replace(A, (k, R, P, $, g, S) => {
        s("xRange", I, k, R, P, $, g, S);
        const F = G(P),
          M = F || G($),
          B = M || G(g),
          Y = B;
        return (
          R === "=" && Y && (R = ""),
          (S = E.includePrerelease ? "-0" : ""),
          F
            ? R === ">" || R === "<"
              ? (k = "<0.0.0-0")
              : (k = "*")
            : R && Y
              ? (M && ($ = 0),
                (g = 0),
                R === ">"
                  ? ((R = ">="),
                    M
                      ? ((P = +P + 1), ($ = 0), (g = 0))
                      : (($ = +$ + 1), (g = 0)))
                  : R === "<=" && ((R = "<"), M ? (P = +P + 1) : ($ = +$ + 1)),
                R === "<" && (S = "-0"),
                (k = `${R + P}.${$}.${g}${S}`))
              : M
                ? (k = `>=${P}.0.0${S} <${+P + 1}.0.0-0`)
                : B && (k = `>=${P}.${$}.0${S} <${P}.${+$ + 1}.0-0`),
          s("xRange return", k),
          k
        );
      });
    },
    Xe = (I, E) => (s("replaceStars", I, E), I.trim().replace(c[h.STAR], "")),
    gt = (I, E) => (
      s("replaceGTE0", I, E),
      I.trim().replace(c[E.includePrerelease ? h.GTE0PRE : h.GTE0], "")
    ),
    nt = (I) => (E, A, k, R, P, $, g, S, F, M, B, Y) => (
      G(k)
        ? (A = "")
        : G(R)
          ? (A = `>=${k}.0.0${I ? "-0" : ""}`)
          : G(P)
            ? (A = `>=${k}.${R}.0${I ? "-0" : ""}`)
            : $
              ? (A = `>=${A}`)
              : (A = `>=${A}${I ? "-0" : ""}`),
      G(F)
        ? (S = "")
        : G(M)
          ? (S = `<${+F + 1}.0.0-0`)
          : G(B)
            ? (S = `<${F}.${+M + 1}.0-0`)
            : Y
              ? (S = `<=${F}.${M}.${B}-${Y}`)
              : I
                ? (S = `<${F}.${M}.${+B + 1}-0`)
                : (S = `<=${S}`),
      `${A} ${S}`.trim()
    ),
    Ye = (I, E, A) => {
      for (let k = 0; k < I.length; k++) if (!I[k].test(E)) return !1;
      if (E.prerelease.length && !A.includePrerelease) {
        for (let k = 0; k < I.length; k++)
          if (
            (s(I[k].semver),
            I[k].semver !== n.ANY && I[k].semver.prerelease.length > 0)
          ) {
            const R = I[k].semver;
            if (
              R.major === E.major &&
              R.minor === E.minor &&
              R.patch === E.patch
            )
              return !0;
          }
        return !1;
      }
      return !0;
    };
  return Rr;
}
var Lr, yo;
function er() {
  if (yo) return Lr;
  yo = 1;
  const o = Symbol("SemVer ANY");
  class e {
    static get ANY() {
      return o;
    }
    constructor(d, f) {
      if (((f = t(f)), d instanceof e)) {
        if (d.loose === !!f.loose) return d;
        d = d.value;
      }
      ((d = d.trim().split(/\s+/).join(" ")),
        s("comparator", d, f),
        (this.options = f),
        (this.loose = !!f.loose),
        this.parse(d),
        this.semver === o
          ? (this.value = "")
          : (this.value = this.operator + this.semver.version),
        s("comp", this));
    }
    parse(d) {
      const f = this.options.loose ? r[i.COMPARATORLOOSE] : r[i.COMPARATOR],
        _ = d.match(f);
      if (!_) throw new TypeError(`Invalid comparator: ${d}`);
      ((this.operator = _[1] !== void 0 ? _[1] : ""),
        this.operator === "=" && (this.operator = ""),
        _[2]
          ? (this.semver = new l(_[2], this.options.loose))
          : (this.semver = o));
    }
    toString() {
      return this.value;
    }
    test(d) {
      if (
        (s("Comparator.test", d, this.options.loose),
        this.semver === o || d === o)
      )
        return !0;
      if (typeof d == "string")
        try {
          d = new l(d, this.options);
        } catch {
          return !1;
        }
      return n(d, this.operator, this.semver, this.options);
    }
    intersects(d, f) {
      if (!(d instanceof e)) throw new TypeError("a Comparator is required");
      return this.operator === ""
        ? this.value === ""
          ? !0
          : new c(d.value, f).test(this.value)
        : d.operator === ""
          ? d.value === ""
            ? !0
            : new c(this.value, f).test(d.semver)
          : ((f = t(f)),
            (f.includePrerelease &&
              (this.value === "<0.0.0-0" || d.value === "<0.0.0-0")) ||
            (!f.includePrerelease &&
              (this.value.startsWith("<0.0.0") || d.value.startsWith("<0.0.0")))
              ? !1
              : !!(
                  (this.operator.startsWith(">") &&
                    d.operator.startsWith(">")) ||
                  (this.operator.startsWith("<") &&
                    d.operator.startsWith("<")) ||
                  (this.semver.version === d.semver.version &&
                    this.operator.includes("=") &&
                    d.operator.includes("=")) ||
                  (n(this.semver, "<", d.semver, f) &&
                    this.operator.startsWith(">") &&
                    d.operator.startsWith("<")) ||
                  (n(this.semver, ">", d.semver, f) &&
                    this.operator.startsWith("<") &&
                    d.operator.startsWith(">"))
                ));
    }
  }
  Lr = e;
  const t = Or,
    { safeRe: r, t: i } = Nt,
    n = vo,
    s = Ht,
    l = Ee,
    c = Ke();
  return Lr;
}
const ac = Ke(),
  cc = (o, e, t) => {
    try {
      e = new ac(e, t);
    } catch {
      return !1;
    }
    return e.test(o);
  };
var tr = cc;
const lc = Ke(),
  dc = (o, e) =>
    new lc(o, e).set.map((t) =>
      t
        .map((r) => r.value)
        .join(" ")
        .trim()
        .split(" "),
    );
var pc = dc;
const hc = Ee,
  uc = Ke(),
  fc = (o, e, t) => {
    let r = null,
      i = null,
      n = null;
    try {
      n = new uc(e, t);
    } catch {
      return null;
    }
    return (
      o.forEach((s) => {
        n.test(s) &&
          (!r || i.compare(s) === -1) &&
          ((r = s), (i = new hc(r, t)));
      }),
      r
    );
  };
var mc = fc;
const vc = Ee,
  gc = Ke(),
  yc = (o, e, t) => {
    let r = null,
      i = null,
      n = null;
    try {
      n = new gc(e, t);
    } catch {
      return null;
    }
    return (
      o.forEach((s) => {
        n.test(s) &&
          (!r || i.compare(s) === 1) &&
          ((r = s), (i = new vc(r, t)));
      }),
      r
    );
  };
var _c = yc;
const $r = Ee,
  wc = Ke(),
  _o = qt,
  Cc = (o, e) => {
    o = new wc(o, e);
    let t = new $r("0.0.0");
    if (o.test(t) || ((t = new $r("0.0.0-0")), o.test(t))) return t;
    t = null;
    for (let r = 0; r < o.set.length; ++r) {
      const i = o.set[r];
      let n = null;
      (i.forEach((s) => {
        const l = new $r(s.semver.version);
        switch (s.operator) {
          case ">":
            (l.prerelease.length === 0 ? l.patch++ : l.prerelease.push(0),
              (l.raw = l.format()));
          case "":
          case ">=":
            (!n || _o(l, n)) && (n = l);
            break;
          case "<":
          case "<=":
            break;
          default:
            throw new Error(`Unexpected operation: ${s.operator}`);
        }
      }),
        n && (!t || _o(t, n)) && (t = n));
    }
    return t && o.test(t) ? t : null;
  };
var Sc = Cc;
const kc = Ke(),
  Ec = (o, e) => {
    try {
      return new kc(o, e).range || "*";
    } catch {
      return null;
    }
  };
var Dc = Ec;
const Nc = Ee,
  wo = er(),
  { ANY: Ic } = wo,
  Tc = Ke(),
  bc = tr,
  Co = qt,
  So = Ar,
  Oc = Pr,
  Kc = Mr,
  Fc = (o, e, t, r) => {
    ((o = new Nc(o, r)), (e = new Tc(e, r)));
    let i, n, s, l, c;
    switch (t) {
      case ">":
        ((i = Co), (n = Oc), (s = So), (l = ">"), (c = ">="));
        break;
      case "<":
        ((i = So), (n = Kc), (s = Co), (l = "<"), (c = "<="));
        break;
      default:
        throw new TypeError('Must provide a hilo val of "<" or ">"');
    }
    if (bc(o, e, r)) return !1;
    for (let h = 0; h < e.set.length; ++h) {
      const d = e.set[h];
      let f = null,
        _ = null;
      if (
        (d.forEach((C) => {
          (C.semver === Ic && (C = new wo(">=0.0.0")),
            (f = f || C),
            (_ = _ || C),
            i(C.semver, f.semver, r)
              ? (f = C)
              : s(C.semver, _.semver, r) && (_ = C));
        }),
        f.operator === l ||
          f.operator === c ||
          ((!_.operator || _.operator === l) && n(o, _.semver)) ||
          (_.operator === c && s(o, _.semver)))
      )
        return !1;
    }
    return !0;
  };
var xr = Fc;
const Ac = xr,
  Mc = (o, e, t) => Ac(o, e, ">", t);
var Pc = Mc;
const Rc = xr,
  Lc = (o, e, t) => Rc(o, e, "<", t);
var $c = Lc;
const ko = Ke(),
  xc = (o, e, t) => (
    (o = new ko(o, t)),
    (e = new ko(e, t)),
    o.intersects(e, t)
  );
var Wc = xc;
const jc = tr,
  Uc = Oe;
var Vc = (o, e, t) => {
  const r = [];
  let i = null,
    n = null;
  const s = o.sort((d, f) => Uc(d, f, t));
  for (const d of s)
    jc(d, e, t)
      ? ((n = d), i || (i = d))
      : (n && r.push([i, n]), (n = null), (i = null));
  i && r.push([i, null]);
  const l = [];
  for (const [d, f] of r)
    d === f
      ? l.push(d)
      : !f && d === s[0]
        ? l.push("*")
        : f
          ? d === s[0]
            ? l.push(`<=${f}`)
            : l.push(`${d} - ${f}`)
          : l.push(`>=${d}`);
  const c = l.join(" || "),
    h = typeof e.raw == "string" ? e.raw : String(e);
  return c.length < h.length ? c : e;
};
const Eo = Ke(),
  Wr = er(),
  { ANY: jr } = Wr,
  It = tr,
  Ur = Oe,
  Bc = (o, e, t = {}) => {
    if (o === e) return !0;
    ((o = new Eo(o, t)), (e = new Eo(e, t)));
    let r = !1;
    e: for (const i of o.set) {
      for (const n of e.set) {
        const s = Hc(i, n, t);
        if (((r = r || s !== null), s)) continue e;
      }
      if (r) return !1;
    }
    return !0;
  },
  Gc = [new Wr(">=0.0.0-0")],
  Do = [new Wr(">=0.0.0")],
  Hc = (o, e, t) => {
    if (o === e) return !0;
    if (o.length === 1 && o[0].semver === jr) {
      if (e.length === 1 && e[0].semver === jr) return !0;
      t.includePrerelease ? (o = Gc) : (o = Do);
    }
    if (e.length === 1 && e[0].semver === jr) {
      if (t.includePrerelease) return !0;
      e = Do;
    }
    const r = new Set();
    let i, n;
    for (const C of o)
      C.operator === ">" || C.operator === ">="
        ? (i = No(i, C, t))
        : C.operator === "<" || C.operator === "<="
          ? (n = Io(n, C, t))
          : r.add(C.semver);
    if (r.size > 1) return null;
    let s;
    if (
      i &&
      n &&
      ((s = Ur(i.semver, n.semver, t)),
      s > 0 || (s === 0 && (i.operator !== ">=" || n.operator !== "<=")))
    )
      return null;
    for (const C of r) {
      if ((i && !It(C, String(i), t)) || (n && !It(C, String(n), t)))
        return null;
      for (const O of e) if (!It(C, String(O), t)) return !1;
      return !0;
    }
    let l,
      c,
      h,
      d,
      f =
        n && !t.includePrerelease && n.semver.prerelease.length ? n.semver : !1,
      _ =
        i && !t.includePrerelease && i.semver.prerelease.length ? i.semver : !1;
    f &&
      f.prerelease.length === 1 &&
      n.operator === "<" &&
      f.prerelease[0] === 0 &&
      (f = !1);
    for (const C of e) {
      if (
        ((d = d || C.operator === ">" || C.operator === ">="),
        (h = h || C.operator === "<" || C.operator === "<="),
        i)
      ) {
        if (
          (_ &&
            C.semver.prerelease &&
            C.semver.prerelease.length &&
            C.semver.major === _.major &&
            C.semver.minor === _.minor &&
            C.semver.patch === _.patch &&
            (_ = !1),
          C.operator === ">" || C.operator === ">=")
        ) {
          if (((l = No(i, C, t)), l === C && l !== i)) return !1;
        } else if (i.operator === ">=" && !It(i.semver, String(C), t))
          return !1;
      }
      if (n) {
        if (
          (f &&
            C.semver.prerelease &&
            C.semver.prerelease.length &&
            C.semver.major === f.major &&
            C.semver.minor === f.minor &&
            C.semver.patch === f.patch &&
            (f = !1),
          C.operator === "<" || C.operator === "<=")
        ) {
          if (((c = Io(n, C, t)), c === C && c !== n)) return !1;
        } else if (n.operator === "<=" && !It(n.semver, String(C), t))
          return !1;
      }
      if (!C.operator && (n || i) && s !== 0) return !1;
    }
    return !((i && h && !n && s !== 0) || (n && d && !i && s !== 0) || _ || f);
  },
  No = (o, e, t) => {
    if (!o) return e;
    const r = Ur(o.semver, e.semver, t);
    return r > 0
      ? o
      : r < 0 || (e.operator === ">" && o.operator === ">=")
        ? e
        : o;
  },
  Io = (o, e, t) => {
    if (!o) return e;
    const r = Ur(o.semver, e.semver, t);
    return r < 0
      ? o
      : r > 0 || (e.operator === "<" && o.operator === "<=")
        ? e
        : o;
  };
var Jc = Bc;
const Vr = Nt,
  To = Gt,
  zc = Ee,
  bo = so,
  Xc = dt,
  Yc = ra,
  qc = na,
  Zc = aa,
  Qc = la,
  el = ha,
  tl = ma,
  rl = ya,
  il = Ca,
  ol = Oe,
  nl = Da,
  sl = Ta,
  al = Fr,
  cl = Fa,
  ll = Pa,
  dl = qt,
  pl = Ar,
  hl = fo,
  ul = mo,
  fl = Mr,
  ml = Pr,
  vl = vo,
  gl = oc,
  yl = er(),
  _l = Ke(),
  wl = tr,
  Cl = pc,
  Sl = mc,
  kl = _c,
  El = Sc,
  Dl = Dc,
  Nl = xr,
  Il = Pc,
  Tl = $c,
  bl = Wc,
  Ol = Vc,
  Kl = Jc;
var Fl = {
  parse: Xc,
  valid: Yc,
  clean: qc,
  inc: Zc,
  diff: Qc,
  major: el,
  minor: tl,
  patch: rl,
  prerelease: il,
  compare: ol,
  rcompare: nl,
  compareLoose: sl,
  compareBuild: al,
  sort: cl,
  rsort: ll,
  gt: dl,
  lt: pl,
  eq: hl,
  neq: ul,
  gte: fl,
  lte: ml,
  cmp: vl,
  coerce: gl,
  Comparator: yl,
  Range: _l,
  satisfies: wl,
  toComparators: Cl,
  maxSatisfying: Sl,
  minSatisfying: kl,
  minVersion: El,
  validRange: Dl,
  outside: Nl,
  gtr: Il,
  ltr: Tl,
  intersects: bl,
  simplifyRange: Ol,
  subset: Kl,
  SemVer: zc,
  re: Vr.re,
  src: Vr.src,
  tokens: Vr.t,
  SEMVER_SPEC_VERSION: To.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: To.RELEASE_TYPES,
  compareIdentifiers: bo.compareIdentifiers,
  rcompareIdentifiers: bo.rcompareIdentifiers,
};
const Al = Vi(Fl);
function Ml() {
  const { autoUpdater: o } = hs;
  return o;
}
class Pl {
  constructor() {
    v(this, "updater");
    p.transports.file.level = "info";
    const e = Ml();
    ((e.logger = p),
      (this.updater = e),
      (this.updater.allowPrerelease = Al.prerelease(z.getVersion()) !== null),
      this.setUpListeners());
  }
  setUpListeners() {
    (this.updater.on("checking-for-update", () => {
      p.info("Checking for updates event received");
    }),
      this.updater.on("update-available", () => {
        p.info("Update available event received");
      }),
      this.updater.on("update-not-available", () => {
        p.info("Update not available event received");
      }),
      this.updater.on("update-downloaded", (e) => {
        (p.info("Update downloaded"),
          m
            .get()
            .windowService.sendDataToMainWin(Bt.onUpdateDownloaded, "true"));
      }),
      this.updater.on("error", () => {
        p.info("Error event received");
      }),
      this.updater.on("download-progress", () => {
        p.info("Download progress event received");
      }),
      p.info("Checking for updates"),
      this.registedManualListeners());
  }
  registedManualListeners() {
    (N.handle(Bt.checkUpdates, async (e) =>
      Ve.getAllWindows().length > 0 ? this.checkForUpdates() : !1,
    ),
      N.handle(Bt.installUpdate, async (e) => {
        this.installUpdate();
      }));
  }
  async checkForUpdates() {
    var e;
    return (
      p.info("|update_service| calling update check"),
      ((e = await this.updater.checkForUpdatesAndNotify()) == null
        ? void 0
        : e.isUpdateAvailable) ?? !1
    );
  }
  installUpdate() {
    this.updater.quitAndInstall();
  }
}
class Rl {
  async convertToLvglFormat(e) {
    try {
      return ns(e);
    } catch (t) {
      throw (p.error(`|image_service| error during conversion: ${t}`), t);
    }
  }
  async convertFromLvglFormat(e) {
    try {
      return ss(e);
    } catch (t) {
      throw (p.error(`|image_service| error during conversion: ${t}`), t);
    }
  }
  async getGifFrameCount(e) {
    try {
      return (await Sr.read(Buffer.from(e))).frames.length;
    } catch (t) {
      p.error(`|image_service| error while reading GIF frame count: ${t}`);
      return;
    }
  }
  async accentForBlackBackground(e, t = {}) {
    const r = t.maxSide ?? 64,
      i = t.contrast ?? 4.5,
      n = await Cr.read(e),
      s = n.bitmap.width,
      l = n.bitmap.height,
      c = Math.min(1, r / Math.max(s, l)),
      h = Math.max(1, Math.round(s * c)),
      d = Math.max(1, Math.round(l * c));
    n.resize({ w: h, h: d });
    const f = n.bitmap.data,
      _ = [];
    for (let b = 0; b < f.length; b += 4)
      f[b + 3] < 16 || _.push([f[b], f[b + 1], f[b + 2]]);
    if (_.length === 0) return Promise.resolve("#FFFFFF");
    const C = _.filter((b) => {
        const [, H, G] = this.rgbToHsl(b[0], b[1], b[2]);
        return G > 0.15 && H > 0.2;
      }),
      O = C.length ? C : _,
      T = Math.min(5, O.length),
      W = this.kmeans(O, T, 10)
        .map((b) => {
          const [, H, G] = this.rgbToHsl(b.color[0], b.color[1], b.color[2]);
          return { ...b, score: b.count * (0.6 + 0.4 * H) * (0.6 + 0.4 * G) };
        })
        .sort((b, H) => H.score - b.score);
    for (const b of W) {
      let H = b.color;
      if (
        (this.contrastAgainstBlack(H) < i && (H = this.liftToContrast(H, i)),
        !this.isNearlyGray(H, 0.04) || W.length === 1)
      )
        return this.rgbToHex(H[0], H[1], H[2]);
    }
    return "#FFFFFF";
  }
  async cropGifImage(e, t, r, i, n, s, l, c) {
    try {
      if (
        (p.info("|image_service| cropping gif image"),
        [t, r, i, n, s, l].some((C) => !Number.isFinite(C)) ||
          t < 0 ||
          r < 0 ||
          i <= 0 ||
          n <= 0 ||
          s <= 0 ||
          l <= 0)
      ) {
        p.error("|image_service| cannot crop gif, parameters are invalid");
        return;
      }
      if (c !== void 0 && (!Number.isInteger(c) || c <= 0)) {
        p.error("|image_service| cannot crop gif, max frame count is invalid");
        return;
      }
      ((t = Math.round(t)),
        (r = Math.round(r)),
        (i = Math.round(i)),
        (n = Math.round(n)),
        (s = Math.round(s)),
        (l = Math.round(l)));
      const h = Buffer.from(e),
        d = await Sr.read(h);
      if (d.height < n + r || d.width < i + t) {
        p.error(
          "|image_service| cannot crop gif, parameters are bigger than the image",
        );
        return;
      }
      const f = c === void 0 ? d.frames : d.frames.slice(0, c);
      if (f.length === 0) {
        p.error("|image_service| cannot crop gif without frames");
        return;
      }
      const _ = this.compositeGifFrames(f, d.width, d.height);
      return (
        _.forEach((C) => {
          const O = new Cr({
            width: C.bitmap.width,
            height: C.bitmap.height,
            data: Buffer.from(C.bitmap.data),
          });
          (O.crop({ x: t, y: r, w: i, h: n }),
            O.resize({ w: s, h: l }),
            (C.bitmap = {
              width: O.bitmap.width,
              height: O.bitmap.height,
              data: Buffer.from(O.bitmap.data),
            }));
        }),
        Sr.quantizeWu(_, 256),
        (await new us().encodeGif(_, d)).buffer
      );
    } catch (h) {
      p.error("|image_service| error while cropping gif, error: " + h);
      return;
    }
  }
  compositeGifFrames(e, t, r) {
    let i = Buffer.alloc(t * r * 4);
    return e.map((n) => {
      const s =
        n.disposalMethod === St.DisposeToPrevious ? Buffer.from(i) : void 0;
      this.drawGifFrame(i, t, r, n);
      const l = new St(t, r, Buffer.from(i), {
        delayCentisecs: n.delayCentisecs,
        disposalMethod: St.DisposeToBackgroundColor,
        xOffset: 0,
        yOffset: 0,
      });
      return (
        n.disposalMethod === St.DisposeToBackgroundColor
          ? this.clearGifFrameArea(i, t, r, n)
          : n.disposalMethod === St.DisposeToPrevious && s && (i = s),
        l
      );
    });
  }
  drawGifFrame(e, t, r, i) {
    const n = i.bitmap.data;
    for (let s = 0; s < i.bitmap.height; s += 1) {
      const l = i.yOffset + s;
      if (!(l < 0 || l >= r))
        for (let c = 0; c < i.bitmap.width; c += 1) {
          const h = i.xOffset + c;
          if (h < 0 || h >= t) continue;
          const d = (s * i.bitmap.width + c) * 4;
          if (n[d + 3] === 0) continue;
          const f = (l * t + h) * 4;
          n.copy(e, f, d, d + 4);
        }
    }
  }
  clearGifFrameArea(e, t, r, i) {
    const n = Math.max(0, i.xOffset),
      s = Math.max(0, i.yOffset),
      l = Math.min(t, i.xOffset + i.bitmap.width),
      c = Math.min(r, i.yOffset + i.bitmap.height);
    for (let h = s; h < c; h += 1) {
      const d = (h * t + n) * 4,
        f = (h * t + l) * 4;
      e.fill(0, d, f);
    }
  }
  kmeans(e, t = 5, r = 10) {
    if (!e.length) return [];
    const i = [],
      n = new Set();
    let s = 5e4;
    for (; s > 0 && i.length < Math.min(t, e.length); ) {
      const c = Math.floor(Math.random() * e.length),
        h = e[c].join(",");
      (n.has(h) || (n.add(h), i.push(e[c].slice())), s--);
    }
    let l = new Array(e.length).fill(0);
    for (let c = 0; c < r; c++) {
      for (let f = 0; f < e.length; f++) {
        let _ = 0,
          C = 1 / 0;
        for (let O = 0; O < i.length; O++) {
          const T = this.sqDist(e[f], i[O]);
          T < C && ((C = T), (_ = O));
        }
        l[f] = _;
      }
      const h = i.map(() => [0, 0, 0]),
        d = i.map(() => 0);
      for (let f = 0; f < e.length; f++) {
        const _ = l[f];
        ((h[_][0] += e[f][0]),
          (h[_][1] += e[f][1]),
          (h[_][2] += e[f][2]),
          (d[_] += 1));
      }
      for (let f = 0; f < i.length; f++)
        d[f] !== 0 &&
          ((i[f][0] = h[f][0] / d[f]),
          (i[f][1] = h[f][1] / d[f]),
          (i[f][2] = h[f][2] / d[f]));
    }
    return i
      .map((c, h) => {
        let d = 0;
        for (let f = 0; f < e.length; f++) l[f] === h && d++;
        return { color: c.map((f) => Math.round(f)), count: d };
      })
      .filter((c) => c.count > 0);
  }
  sqDist(e, t) {
    const r = e[0] - t[0],
      i = e[1] - t[1],
      n = e[2] - t[2];
    return r * r + i * i + n * n;
  }
  rgbToHex(e, t, r) {
    const i = (n) => this.clamp(n).toString(16).padStart(2, "0");
    return `#${i(e)}${i(t)}${i(r)}`;
  }
  clamp(e) {
    return Math.max(0, Math.min(255, Math.round(e)));
  }
  rgbToHsl(e, t, r) {
    ((e /= 255), (t /= 255), (r /= 255));
    const i = Math.max(e, t, r),
      n = Math.min(e, t, r);
    let s = 0,
      l = 0,
      c = (i + n) / 2;
    if (i !== n) {
      const h = i - n;
      switch (((l = c > 0.5 ? h / (2 - i - n) : h / (i + n)), i)) {
        case e:
          s = (t - r) / h + (t < r ? 6 : 0);
          break;
        case t:
          s = (r - e) / h + 2;
          break;
        default:
          s = (e - t) / h + 4;
      }
      s /= 6;
    }
    return [s, l, c];
  }
  isNearlyGray(e, t = 0.06) {
    const [, r] = this.rgbToHsl(e[0], e[1], e[2]);
    return r < t * 5;
  }
  relLum(e) {
    const t = (s) => (
        (s /= 255),
        s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      ),
      r = t(e[0]),
      i = t(e[1]),
      n = t(e[2]);
    return 0.2126 * r + 0.7152 * i + 0.0722 * n;
  }
  contrastAgainstBlack(e) {
    return (this.relLum(e) + 0.05) / 0.05;
  }
  liftToContrast(e, t = 4.5) {
    if (this.contrastAgainstBlack(e) >= t) return e.map(this.clamp);
    let r = 0,
      i = 1,
      n = e;
    for (let s = 0; s < 16; s++) {
      const l = (r + i) / 2,
        c = this.mix(e, [255, 255, 255], l);
      this.contrastAgainstBlack(c) >= t ? ((n = c), (i = l)) : (r = l);
    }
    return n.map(this.clamp);
  }
  mix(e, t, r) {
    return [
      e[0] + (t[0] - e[0]) * r,
      e[1] + (t[1] - e[1]) * r,
      e[2] + (t[2] - e[2]) * r,
    ];
  }
}
class Ll {
  constructor() {
    v(this, "tray");
  }
  createNewTray() {
    const e = this.getTrayIconPath();
    this.tray = new qn(e);
    const t = Fe.buildFromTemplate([
      {
        label: "Show Input",
        click: async () => {
          var i, n;
          const r = m.get().windowService;
          ((r.mainWin === void 0 || r.mainWin === null) &&
            (await r.createMainWindow(),
            await ((i = z.dock) == null ? void 0 : i.show())),
            (n = r.mainWin) == null || n.show());
        },
      },
      {
        label: "Quit",
        click: () => {
          (z.quit(), process.exit(0));
        },
      },
    ]);
    (this.tray.setContextMenu(t), this.tray.setToolTip("Input"));
  }
  getTrayIconPath() {
    return ue(
      process.env.VITE_PUBLIC,
      "assets",
      process.platform === "darwin"
        ? "tray_icon_Template.png"
        : "tray_icon.ico",
    );
  }
}
const $l = { title: "Knob1", body: "Your timer is up!" },
  xl = {
    title: "Nomad_E",
    body: "Focus session done \u2014 enjoy your break.",
  },
  Wl = { title: "Nomad_E", body: "Break's over. It's focus time!" },
  jl = { TIMER_END: $l, POMODORO_WORK_END: xl, POMODORO_BREAK_END: Wl };
class Ul {
  async onNotifyReceived(e, t) {
    if ((await m.get().devicesCommManager.getDevice(e)) === void 0) return;
    if (t.key === void 0) {
      p.error("|NotificationService| notification type is empty");
      return;
    }
    p.info("|NotificationService| received notification of type: " + t.key);
    const r = t.key,
      i = jl[r];
    new Zn({ title: i.title, body: i.body }).show();
  }
}
class pt {
  constructor() {
    v(this, "listeners", new Set());
    v(this, "_maxListeners", 50);
  }
  setMaxListeners(e) {
    if (!Number.isFinite(e) || e < 0)
      throw new TypeError("maxListeners must be a non-negative finite number");
    this._maxListeners = Math.floor(e);
  }
  on(e) {
    return this.listeners.size >= this._maxListeners
      ? (console.error(
          `EventEmitter: listener limit reached (${this._maxListeners}). Dropping new listener.`,
        ),
        () => {})
      : (this.listeners.add(e), () => this.listeners.delete(e));
  }
  emit(e) {
    for (const t of this.listeners)
      try {
        t(e);
      } catch (r) {
        console.error("EventEmitter listener threw:", r);
      }
  }
  listenerCount() {
    return this.listeners.size;
  }
  clear() {
    this.listeners.clear();
  }
}
var rr = ((o) => (
  (o.shutdown = "shutdown"),
  (o.searchDevices = "searchDevices"),
  (o.result = "searchDevicesResult"),
  (o.error = "searchDevicesError"),
  o
))(rr || {});
class ar {
  constructor() {
    v(this, "devicesListener", new pt());
    v(this, "bootloaderDevicesListener", new pt());
    v(this, "cachedDevices", []);
    v(this, "cachedBootloaderDevices", []);
    v(this, "worker");
    v(this, "started", !1);
    v(this, "searchInProgress", !1);
    v(this, "pollInterval");
  }
  start() {
    this.started ||
      ((this.started = !0),
      this.startWorker(),
      this.searchDevices(),
      this.startPolling());
  }
  resetFoundDevices() {
    ((this.cachedDevices = []), (this.cachedBootloaderDevices = []));
  }
  dispose() {
    var e;
    (this.pollInterval &&
      (clearInterval(this.pollInterval), (this.pollInterval = void 0)),
      (e = this.worker) == null || e.postMessage(rr.shutdown),
      (this.worker = void 0),
      (this.started = !1),
      (this.searchInProgress = !1));
  }
  startWorker() {
    if (this.worker) {
      p.warn("|SearchDevicesService| worker already running");
      return;
    }
    const e = fe(__dirname, "../workers/search_devices_worker.js");
    ((this.worker = new ms(e)),
      this.worker.on("message", (t) => {
        if (((this.searchInProgress = !1), t.type === rr.result))
          this.processWorkerResults(t.hidDevices, t.bootloaderDevices);
        else {
          p.error("|SearchDevicesService| worker error: " + t.error);
          return;
        }
      }),
      this.worker.on("error", (t) => {
        ((this.searchInProgress = !1),
          p.error("|SearchDevicesService| worker crashed, restarting: " + t),
          (this.worker = void 0),
          this.started && this.startWorker());
      }),
      this.worker.on("exit", (t) => {
        t !== 0 &&
          this.started &&
          (p.error(`|SearchDevicesService| worker exited with code ${t}`),
          (this.worker = void 0),
          this.startWorker());
      }));
  }
  processWorkerResults(e, t) {
    const r = e.map((n) => le.fromWLDevice(n)),
      i = t.map((n) => le.fromWLDevice(n));
    (this.compareDevices(this.cachedDevices, r) ||
      (p.info("|SearchDevicesService| new devices found"),
      (this.cachedDevices = r),
      this.devicesListener.emit(r)),
      this.compareDevices(this.cachedBootloaderDevices, i) ||
        (p.info("|SearchDevicesService| new bootloader devices found"),
        (this.cachedBootloaderDevices = i),
        this.bootloaderDevicesListener.emit(i)));
  }
  startPolling() {
    this.pollInterval ||
      (this.pollInterval = setInterval(() => {
        this.searchDevices();
      }, 1e3));
  }
  searchDevices() {
    var e;
    if ((this.worker || this.startWorker(), this.searchInProgress)) {
      p.debug(
        "|SearchDevicesService| search already in progress, skipping tick",
      );
      return;
    }
    ((this.searchInProgress = !0),
      (e = this.worker) == null || e.postMessage(rr.searchDevices));
  }
  getBootloaderDevices() {
    return this.cachedBootloaderDevices;
  }
  compareDevices(e, t) {
    if (e.length !== t.length) return !1;
    const r = new Set(t.map(ar.getDeviceKey));
    for (const i of e) if (!r.delete(ar.getDeviceKey(i))) return !1;
    return r.size === 0;
  }
  static getDeviceKey(e) {
    return [
      e.portPath,
      e.devicePid,
      e.connectionType,
      e.deviceType,
      e.layoutType,
      e.isUsbConnection ? "1" : "0",
    ].join("|");
  }
}
var De = ((o) => (
  (o.appSettings = "app_settings"),
  (o.devices = "devices"),
  (o.presets = "presets"),
  (o.migrations = "migrations"),
  o
))(De || {});
class Vl {
  constructor() {
    v(this, "db");
    v(this, "deviceCollection");
    v(this, "presetsCollection");
    v(this, "appSettingsCollection");
    v(this, "migrationsCollection");
    v(this, "initPromise");
    p.info("|storage_service| initializing db");
    const e = ue(z.getPath("userData"), "input_storage.json");
    this.initPromise = new Promise((t, r) => {
      this.db = new vs(e, {
        autoload: !0,
        autoloadCallback: (i) => {
          if (i) {
            (p.error("|storage_service| error during init", i), r(i));
            return;
          }
          (this.initDb(), t());
        },
        autosave: !1,
      });
    });
  }
  async ensureInitialized() {
    return this.initPromise;
  }
  initDb() {
    (p.info("|storage_service| db initialized"),
      this.initAppSettings(),
      this.initDevices(),
      this.initPresets(),
      this.initMigrations());
  }
  onDestroy() {
    this.db.saveDatabase();
  }
  initAppSettings() {
    var e, t, r;
    if (!this.db.getCollection(De.appSettings)) {
      (p.warn("|storage_service| did not find app settings"),
        (this.appSettingsCollection = this.db.addCollection(De.appSettings)),
        (t = (e = this.db).saveDatabase) == null ||
          t.call(e, (i) => {
            i && p.error("|storage_service| error while saving db: " + i);
          }));
      return;
    }
    (p.info("|storage_service| initialized app settings"),
      (this.appSettingsCollection =
        (r = this.db) == null ? void 0 : r.getCollection(De.appSettings)));
  }
  initDevices() {
    var e, t, r;
    if (!this.db.getCollection(De.devices)) {
      (p.warn("|storage_service| did not find devices"),
        (this.deviceCollection = this.db.addCollection(De.devices)),
        (t = (e = this.db).saveDatabase) == null ||
          t.call(e, (i) => {
            i && p.error("|storage_service| error while saving db: " + i);
          }));
      return;
    }
    (p.info("|storage_service| initialized device data"),
      (this.deviceCollection =
        (r = this.db) == null ? void 0 : r.getCollection(De.devices)));
  }
  initPresets() {
    var e, t, r;
    if (!this.db.getCollection(De.presets)) {
      (p.warn("|storage_service| did not find presets"),
        (this.presetsCollection = this.db.addCollection(De.presets)),
        (t = (e = this.db).saveDatabase) == null ||
          t.call(e, (i) => {
            i && p.error("|storage_service| error while saving db: " + i);
          }));
      return;
    }
    (p.info("|storage_service| initialized presets"),
      (this.presetsCollection =
        (r = this.db) == null ? void 0 : r.getCollection(De.presets)));
  }
  initMigrations() {
    var e, t, r;
    if (!this.db.getCollection(De.migrations)) {
      (p.warn("|storage_service| did not find migrations"),
        (this.migrationsCollection = this.db.addCollection(De.migrations)),
        (t = (e = this.db).saveDatabase) == null ||
          t.call(e, (i) => {
            i && p.error("|storage_service| error while saving db: " + i);
          }));
      return;
    }
    (p.info("|storage_service| initialized migrations"),
      (this.migrationsCollection =
        (r = this.db) == null ? void 0 : r.getCollection(De.migrations)));
  }
  getShownMigrations() {
    if (!this.migrationsCollection) {
      p.error("|storage_service| migrations collection is not ready");
      return;
    }
    const e = this.migrationsCollection.findOne();
    return (
      (e == null ? void 0 : e.shownMigrationIds) ??
      (e == null ? void 0 : e.shownVersions)
    );
  }
  saveShownMigration(e) {
    var r, i;
    if (!this.migrationsCollection) {
      p.error("|storage_service| migrations collection is not ready");
      return;
    }
    const t = this.migrationsCollection.findOne();
    if (t) {
      const n = t.shownMigrationIds ?? t.shownVersions ?? [];
      (n.includes(e) || n.push(e),
        (t.shownMigrationIds = n),
        this.migrationsCollection.update(t));
    } else this.migrationsCollection.insert({ shownMigrationIds: [e] });
    (p.info("|storage_service| saving db!"),
      (i = (r = this.db).saveDatabase) == null ||
        i.call(r, (n) => {
          n && p.error("|storage_service| error while saving db: " + n);
        }));
  }
  getAppSettings() {
    if (!this.appSettingsCollection) {
      p.error("|storage_service| app settings is not ready");
      return;
    }
    return this.appSettingsCollection.findOne();
  }
  saveAppSettings(e) {
    var r, i;
    if (!this.appSettingsCollection) {
      p.error("|storage_service| app settings collection is not ready");
      return;
    }
    const t = this.appSettingsCollection.findOne();
    (t
      ? (p.info("|storage_service| app settings already exists, updating it!"),
        Object.assign(t, e),
        this.appSettingsCollection.update(t))
      : (p.info("|storage_service| app settings is new adding it!"),
        this.appSettingsCollection.insert(e)),
      p.info("|storage_service| saving db!"),
      (i = (r = this.db).saveDatabase) == null ||
        i.call(r, (n) => {
          n && p.error("|storage_service| error while saving db: " + n);
        }));
  }
  getDeviceConfig(e) {
    if (!this.deviceCollection) {
      p.error("|storage_service| device collection is not ready");
      return;
    }
    return this.deviceCollection.findOne({ "device.devicePid": e });
  }
  saveDeviceConfig(e, t) {
    var i, n;
    if (!this.deviceCollection)
      return (p.error("|storage_service| device collection is not ready"), !1);
    const r = this.deviceCollection.findOne({ "device.devicePid": e });
    return (
      r
        ? (p.info("|storage_service| config already exists, updating it!"),
          Object.assign(r, t),
          this.deviceCollection.update(r))
        : (p.info("|storage_service| config is new adding it!"),
          this.deviceCollection.insert(t)),
      p.info("|storage_service| saving db!"),
      (n = (i = this.db).saveDatabase) == null ||
        n.call(i, (s) => {
          s && p.error("|storage_service| error while saving db: " + s);
        }),
      !0
    );
  }
  getSavedPresets() {
    var e;
    return (e = this.presetsCollection) == null ? void 0 : e.find();
  }
  savePreset(e) {
    var r, i;
    if (!this.presetsCollection) {
      p.error("|storage_service| preset collection is not ready");
      return;
    }
    const t = this.presetsCollection.findOne({ id: e.id });
    (t
      ? (p.info("|storage_service| preset already exists, updating it!"),
        Object.assign(t, e),
        this.presetsCollection.update(t))
      : (p.info("|storage_service| preset is new adding it!"),
        this.presetsCollection.insert(e)),
      p.info("|storage_service| saving db!"),
      (i = (r = this.db).saveDatabase) == null ||
        i.call(r, (n) => {
          n && p.error("|storage_service| error while saving db: " + n);
        }));
  }
}
var Qe = ((o) => (
  (o.getDeviceConfig = "localStorageGetDeviceConfig"),
  (o.saveDeviceConfig = "localStorageSaveDeviceConfig"),
  (o.getPresets = "localStorageGetPresets"),
  (o.savePreset = "localStorageSavePreset"),
  (o.getShownMigrations = "localStorageGetShownMigrations"),
  (o.markMigrationShown = "localStorageMarkMigrationShown"),
  o
))(Qe || {});
class Bl {
  constructor() {
    this.createHandlers();
  }
  createHandlers() {
    (p.info("|local_storage_channel| adding listeners"),
      N.handle(Qe.getDeviceConfig, (e, t) => this.getDeviceConfig(t)),
      N.handle(Qe.saveDeviceConfig, (e, t, r) => this.saveDeviceConfig(t, r)),
      N.handle(Qe.getPresets, (e) => this.getPresets()),
      N.handle(Qe.savePreset, (e, t) => this.savePreset(t)),
      N.handle(Qe.getShownMigrations, (e) => this.getShownMigrations()),
      N.handle(Qe.markMigrationShown, (e, t) => this.markMigrationShown(t)));
  }
  getDeviceConfig(e) {
    return Promise.resolve(m.get().storageService.getDeviceConfig(e.devicePid));
  }
  saveDeviceConfig(e, t) {
    return (
      p.info("|local_storage_channel| saving device config"),
      Promise.resolve(m.get().storageService.saveDeviceConfig(e.devicePid, t))
    );
  }
  getPresets() {
    return Promise.resolve(m.get().storageService.getSavedPresets());
  }
  savePreset(e) {
    return Promise.resolve(m.get().storageService.savePreset(e));
  }
  getShownMigrations() {
    return Promise.resolve(m.get().storageService.getShownMigrations());
  }
  markMigrationShown(e) {
    return Promise.resolve(m.get().storageService.saveShownMigration(e));
  }
}
class Gl {
  constructor(e, t, r, i, n) {
    v(this, "trackName");
    v(this, "artist");
    v(this, "duration");
    v(this, "elapsed");
    v(this, "isPlaying");
    v(this, "albumArt");
    ((this.trackName = e),
      (this.artist = t),
      (this.duration = r),
      (this.elapsed = i),
      (this.isPlaying = n));
  }
}
class Hl extends Gl {
  constructor({
    appType: t,
    trackName: r,
    artist: i,
    duration: n,
    elapsed: s,
    artworkUrl: l,
    artworkData: c,
    isPlaying: h,
  }) {
    super(r, i, n, s, h);
    v(this, "appType");
    v(this, "artworkUrl");
    v(this, "artworkData");
    ((this.appType = t), (this.artworkUrl = l), (this.artworkData = c));
  }
}
class Jl {
  constructor({ appName: e, process: t, path: r }) {
    v(this, "appName");
    v(this, "process");
    v(this, "path");
    ((this.appName = e), (this.process = t), (this.path = r));
  }
}
class zl {
  constructor() {
    v(this, "cliPath");
    ((this.cliPath = this.getCliPath()), p.info(this.cliPath));
  }
  async getMediaPlayerInfo() {
    return new Promise((e, t) => {
      try {
        const r = ue(this.cliPath, "media-info-retriever.scpt");
        p.info("|native_service| fetching basic media info");
        const i = ji("osascript", [r]);
        let n = "";
        (i.stderr.on("error", (s) => {
          p.error(s);
        }),
          i.stdout.on("data", (s) => {
            n += s;
          }),
          i.stdout.on("end", () => {
            p.info(n);
            const s = this.parseAppleScriptData(n);
            if (s.has("error_code")) {
              t(s.get("error_code"));
              return;
            }
            if (!s.has("app_name")) {
              t("Cannot find app_name in retieved data");
              return;
            }
            if (s.get("app_name") === "unknown") {
              e(void 0);
              return;
            }
            if (
              !s.has("song_name") ||
              !s.has("song_artist") ||
              !s.has("total_duration") ||
              !s.has("elapsed")
            ) {
              t("Cannot find media info data");
              return;
            }
            const l = s.get("app_name"),
              c = s.get("song_name"),
              h = s.get("song_artist"),
              d = s.get("total_duration");
            let f = s.get("elapsed");
            const _ = s.get("artwork_url"),
              C = s.get("artwork_data"),
              O = s.get("playback_status");
            let T = !1;
            (O !== void 0 && (T = O === "1"),
              l === "media_remote" && (f = "-1"),
              e(
                new Hl({
                  appType: l,
                  trackName: c ?? "",
                  artist: h ?? "",
                  duration: parseInt(d ?? "-1"),
                  elapsed: parseInt(f ?? "-1"),
                  artworkUrl: _,
                  artworkData: C,
                  isPlaying: T,
                }),
              ));
          }));
      } catch (r) {
        (p.error(`|native_service| error while getting media data ${r}`), t(r));
      }
    });
  }
  getWindowInFocus() {
    return new Promise((e, t) => {
      try {
        const r = ue(this.cliPath, "window-info-retriever.scpt"),
          i = ji("osascript", [r]);
        let n = "";
        (i.stderr.on("error", (s) => {
          p.error(s);
        }),
          i.stdout.on("data", (s) => {
            n += s;
          }),
          i.stdout.on("end", () => {
            const s = this.parseAppleScriptData(n);
            if (s.has("error_code")) {
              t(s.get("error_code"));
              return;
            }
            if (!s.has("app_name")) {
              t("Cannot find app_name in retieved data");
              return;
            }
            const l = s.get("app_name"),
              c = s.get("bundle_id");
            if (!l) {
              e(void 0);
              return;
            }
            e(new Jl({ appName: l, process: c }));
          }));
      } catch (r) {
        (p.error(`|native_service| error while getting window in focus ${r}`),
          t(r));
      }
    });
  }
  getApplications() {
    return new Promise(async (e) => {
      const t = [
        "/Applications",
        Ct.join(Mi.homedir(), "Applications"),
        "/System/Applications",
        "/System/Applications/Utilities",
      ];
      let r = [];
      const i = new Set();
      for (const n of t)
        if (te.existsSync(n))
          try {
            const s = te.readdirSync(n);
            for (const l of s) {
              if (!l.endsWith(".app")) continue;
              const c = Ct.join(n, l),
                h = l.replace(/\.app$/, "");
              if (i.has(h)) continue;
              i.add(h);
              const d = await this.getMacIcon(c);
              r.push({ name: h, path: c, icon: d });
            }
          } catch (s) {
            p.error(`|mac_native_service| failed to get app with error: ${s}`);
          }
      e(r.sort((n, s) => n.name.localeCompare(s.name)));
    });
  }
  async openExternalApp(e) {
    return new Promise((t, r) => {
      (p.info("|native_service| opening external application"),
        Ui("open", [e], (i) => {
          i
            ? (p.error(
                `|mac_native_service| failed to open app with error: ${i.message}`,
              ),
              r(i.message))
            : t(!0);
        }));
    });
  }
  insertText(e) {
    return new Promise((t, r) => {
      const i = ue(this.cliPath, "send-paste-event.scpt"),
        n = this.readClipboard();
      (p.info("|native_service| inserting text"),
        qe.writeText(e),
        Ui("osascript", [i], (s, l, c) => {
          try {
            this.restoreClipboard(n);
          } catch (h) {
            p.error(`|native_service| failed to restore clipboard: ${h}`);
          }
          s
            ? (p.info("|native_service| error: " + s), r(c))
            : (p.info("|native_service| result: " + l), t(!0));
        }));
    });
  }
  readClipboard() {
    const e = qe.readImage(),
      t = qe.readBookmark();
    return {
      text: qe.readText(),
      html: qe.readHTML(),
      rtf: qe.readRTF(),
      image: e.isEmpty() ? void 0 : e,
      bookmark: t.title || t.url ? t.title : void 0,
    };
  }
  restoreClipboard(e) {
    qe.write(e);
  }
  getCliPath() {
    if (z.isPackaged) {
      const e = process.resourcesPath;
      return ue(e, "scripts");
    }
    return ue(__dirname, "../../resources/scripts");
  }
  parseAppleScriptData(e) {
    let t = new Map();
    return (
      e
        .split(",")
        .map((r) => r.trim())
        .forEach((r) => {
          const i = r.indexOf(":"),
            n = r.substring(0, i),
            s = r.substring(i + 1);
          t.set(n, s);
        }),
      t
    );
  }
  async getMacIcon(e) {
    const t = await this.readMacIconName(e);
    if (!t) return;
    const r = Ct.join(e, "Contents", "Resources", t);
    if (te.existsSync(r)) return this.icnsToPngBase64(r);
  }
  readMacIconName(e) {
    return new Promise((t) => {
      const r = Ct.join(e, "Contents", "Info.plist");
      if (!te.existsSync(r)) return t(void 0);
      Er(`plutil -convert json -o - "${r}"`, (i, n) => {
        if (i || !n) return t(void 0);
        try {
          const s = JSON.parse(n);
          let l = s.CFBundleIconFile || s.CFBundleIconName || null;
          (l && !l.endsWith(".icns") && (l += ".icns"), t(l));
        } catch {
          t(void 0);
        }
      });
    });
  }
  icnsToPngBase64(e) {
    return new Promise((t) => {
      const r = Ct.join(Mi.tmpdir(), `icon_${Date.now()}.png`);
      Er(
        `sips -s format png --resampleHeightWidthMax 64 "${e}" --out "${r}"`,
        (i) => {
          if (i) return t(void 0);
          try {
            const n = te.readFileSync(r);
            (te.unlinkSync(r),
              t("data:image/png;base64," + n.toString("base64")));
          } catch {
            t(void 0);
          }
        },
      );
    });
  }
}
class Xl {
  constructor() {
    v(this, "getFocusApp", !1);
    v(this, "focusAppDevices", []);
    v(this, "lastAppInFocus");
    this.handleDeviceConnection();
  }
  handleDeviceConnection() {
    const e = m.get().devicesCommManager;
    e.onConnectionEvent((t) => {
      const r = e.getDevice(t.deviceId);
      if (
        t.type === Le.CONNECTED &&
        r != null &&
        r.features.get(Z.focusedApp)
      ) {
        (p.info(
          "|focus_app_service| connected device that has app focus feature",
        ),
          this.focusAppDevices.push(r),
          this.startFocusApp());
        return;
      }
      if (
        (t.type === Le.DISCONNECTED || t.type === Le.ERROR) &&
        ((this.focusAppDevices = this.focusAppDevices.filter(
          (i) => i.id !== t.deviceId,
        )),
        this.focusAppDevices.length <= 0)
      ) {
        (p.info("|focus_app_service| no devices that has app focus feature"),
          this.stopFocusApp());
        return;
      }
    });
  }
  async getAppInFocus() {
    if (this.getFocusApp) {
      try {
        const e = await m.get().nativeService.getWindowInFocus();
        e
          ? this.handleAppInFocus(e)
          : p.error("|focus_app_service| could not get app in focus");
      } catch (e) {
        p.error(
          "|focus_app_service| received error while getting app in focus, error:" +
            e,
        );
      }
      setTimeout(() => this.getAppInFocus(), 1e3);
    }
  }
  handleAppInFocus(e) {
    var t, r, i;
    (e.appName !== ((t = this.lastAppInFocus) == null ? void 0 : t.appName) ||
      e.process !== ((r = this.lastAppInFocus) == null ? void 0 : r.process) ||
      e.path !== ((i = this.lastAppInFocus) == null ? void 0 : i.path)) &&
      (p.info("|focus_app_service| app in focus changed"),
      (this.lastAppInFocus = e),
      this.focusAppDevices.forEach((n) => {
        n.rpcService.sendFocusApp(e);
      }));
  }
  stopFocusApp() {
    this.getFocusApp &&
      (p.info("|focus_app_service| stopping app focus collection"),
      (this.focusAppDevices = []),
      (this.getFocusApp = !1));
  }
  startFocusApp() {
    this.getFocusApp ||
      (p.info("|focus_app_service| starting app focus collection"),
      (this.getFocusApp = !0),
      this.getAppInFocus());
  }
  async startAutodetect() {
    try {
      p.info("|focus_app_service| starting autodetect");
      const e = await m.get().nativeService.getWindowInFocus();
      if (!e) {
        p.error("|focus_app_service| cannot detect input app");
        return;
      }
      for (let t = 0; t < 10; t++) {
        (await new Promise((i) => setTimeout(() => i(), 1e3)),
          p.info("|focus_app_service| ticking"));
        const r = await m.get().nativeService.getWindowInFocus();
        if (
          (r == null ? void 0 : r.appName) !==
            (e == null ? void 0 : e.appName) ||
          (r == null ? void 0 : r.process) !==
            (e == null ? void 0 : e.process) ||
          (r == null ? void 0 : r.path) !== (e == null ? void 0 : e.path)
        )
          return await this.startAutodetectTimer(e);
      }
      return;
    } catch (e) {
      p.error("|focus_app_service| error during autodetect, error: " + e);
      return;
    }
  }
  async startAutodetectTimer(e) {
    p.info("|focus_app_service| starting autodetect timer");
    let t;
    for (let r = 0; r < 5; r++) {
      await new Promise((n) => setTimeout(n, 1e3));
      const i = await m.get().nativeService.getWindowInFocus();
      ((i == null ? void 0 : i.appName) !== (e == null ? void 0 : e.appName) ||
        (i == null ? void 0 : i.process) !== (e == null ? void 0 : e.process) ||
        (i == null ? void 0 : i.path) !== (e == null ? void 0 : e.path)) &&
        (t = i);
    }
    return (p.info("|focus_app_service| stopping autodetect timer"), t);
  }
}
var L = ((o) => (
  (o.mediaPlayerFetchData = "mp.fetch_data"),
  (o.genericAlert = "alert.generic"),
  (o.radialMenu = "kb.radial"),
  (o.insertText = "kb.sa.inserttext"),
  (o.execCmd = "kb.sa.exec"),
  (o.openApplication = "kb.sa.openapp"),
  (o.operUrl = "kb.sa.openurl"),
  (o.showCheatSheet = "kb.cs.show"),
  (o.hideCheatSheet = "kb.cs.hide"),
  (o.toggleCheatSheet = "kb.cs.toggle"),
  (o.diagnostic = "diag.report"),
  o
))(L || {});
class Oo {
  constructor(e, t) {
    v(this, "id");
    v(this, "info");
    v(this, "commService");
    v(this, "rpcService");
    v(this, "features", new Map());
    v(this, "updateInfo");
    v(this, "notifyRouter");
    v(this, "filesFetchStatus", new Map());
    ((this.id = e), (this.info = t));
    const r = { info: p.info, error: p.error, debug: p.debug, warn: p.warn };
    ((this.commService = new as(r)),
      (this.rpcService = new Pi(this.commService, r)),
      this.createDeviceFeatures(),
      this.createNotifyListeners());
  }
  async createDeviceFeatures() {
    switch (this.info.deviceType) {
      case U.NomadE:
        (this.features.set(Z.mediaPlayer, !1),
          this.features.set(Z.alert, !0),
          this.features.set(Z.wallpaper, !0));
        break;
      case U.NomadEV2:
        (this.features.set(Z.mediaPlayer, !1),
          this.features.set(Z.alert, !0),
          this.features.set(Z.wallpaper, !0));
        break;
      case U.Knob:
      case U.KnobF1:
        (this.features.set(Z.alert, !0), this.features.set(Z.wallpaper, !0));
        break;
      case U.CreatorMicroV2:
        (this.features.set(Z.radialMenu, !0),
          this.features.set(Z.focusedApp, !0));
        break;
      case U.XYZ:
        this.features.set(Z.focusedApp, !0);
        break;
      case U.CodexMicro:
        (this.features.set(Z.radialMenu, !0),
          this.features.set(Z.focusedApp, !0));
        break;
    }
  }
  setNotifyRouter(e) {
    this.notifyRouter = e;
  }
  async createNotifyListeners() {
    switch (
      (this.createSANotifyListeners(),
      this.commService.addNotifyHandler(L.diagnostic, (e) => {
        var t;
        return (t = this.notifyRouter) == null
          ? void 0
          : t.call(this, L.diagnostic, e);
      }),
      this.info.deviceType)
    ) {
      case U.NomadE:
        (this.commService.addNotifyHandler(
          L.mediaPlayerFetchData.toString(),
          (e) => {
            if (this.features.has(Z.mediaPlayer) && this.notifyRouter) {
              this.notifyRouter(L.mediaPlayerFetchData, e);
              return;
            }
          },
        ),
          this.commService.addNotifyHandler(L.genericAlert, (e) => {
            if (this.features.has(Z.alert) && this.notifyRouter) {
              this.notifyRouter(L.genericAlert, e);
              return;
            }
          }));
        break;
      case U.NomadEV2:
        (this.commService.addNotifyHandler(
          L.mediaPlayerFetchData.toString(),
          (e) => {
            if (this.features.has(Z.mediaPlayer) && this.notifyRouter) {
              this.notifyRouter(L.mediaPlayerFetchData, e);
              return;
            }
          },
        ),
          this.commService.addNotifyHandler(L.genericAlert, (e) => {
            if (this.features.has(Z.alert) && this.notifyRouter) {
              this.notifyRouter(L.genericAlert, e);
              return;
            }
          }));
        break;
      case U.Knob:
      case U.KnobF1:
        this.commService.addNotifyHandler(L.genericAlert, (e) => {
          if (this.features.has(Z.alert) && this.notifyRouter) {
            this.notifyRouter(L.genericAlert, e);
            return;
          }
        });
        break;
      case U.CreatorMicroV2:
        (this.commService.addNotifyHandler(L.radialMenu, (e) => {
          var t;
          return (t = this.notifyRouter) == null
            ? void 0
            : t.call(this, L.radialMenu, e);
        }),
          this.commService.addNotifyHandler(L.showCheatSheet, (e) => {
            var t;
            return (t = this.notifyRouter) == null
              ? void 0
              : t.call(this, L.showCheatSheet, e);
          }),
          this.commService.addNotifyHandler(L.hideCheatSheet, (e) => {
            var t;
            return (t = this.notifyRouter) == null
              ? void 0
              : t.call(this, L.hideCheatSheet, e);
          }),
          this.commService.addNotifyHandler(L.toggleCheatSheet, (e) => {
            var t;
            return (t = this.notifyRouter) == null
              ? void 0
              : t.call(this, L.toggleCheatSheet, e);
          }));
        break;
      case U.CodexMicro:
        (this.commService.addNotifyHandler(L.radialMenu, (e) => {
          var t;
          return (t = this.notifyRouter) == null
            ? void 0
            : t.call(this, L.radialMenu, e);
        }),
          this.commService.addNotifyHandler(L.showCheatSheet, (e) => {
            var t;
            return (t = this.notifyRouter) == null
              ? void 0
              : t.call(this, L.showCheatSheet, e);
          }),
          this.commService.addNotifyHandler(L.hideCheatSheet, (e) => {
            var t;
            return (t = this.notifyRouter) == null
              ? void 0
              : t.call(this, L.hideCheatSheet, e);
          }),
          this.commService.addNotifyHandler(L.toggleCheatSheet, (e) => {
            var t;
            return (t = this.notifyRouter) == null
              ? void 0
              : t.call(this, L.toggleCheatSheet, e);
          }));
        break;
    }
  }
  async createSANotifyListeners() {
    (this.commService.addNotifyHandler(L.insertText, (e) => {
      var t;
      return (t = this.notifyRouter) == null
        ? void 0
        : t.call(this, L.insertText, e);
    }),
      this.commService.addNotifyHandler(L.execCmd, (e) => {
        var t;
        return (t = this.notifyRouter) == null
          ? void 0
          : t.call(this, L.execCmd, e);
      }),
      this.commService.addNotifyHandler(L.operUrl, (e) => {
        var t;
        return (t = this.notifyRouter) == null
          ? void 0
          : t.call(this, L.operUrl, e);
      }),
      this.commService.addNotifyHandler(L.openApplication, (e) => {
        var t;
        return (t = this.notifyRouter) == null
          ? void 0
          : t.call(this, L.openApplication, e);
      }));
  }
  async connect() {
    return this.commService.connect(this.info);
  }
  isConnected() {
    return this.commService.isConnected();
  }
  async disconnect() {
    return this.commService.disconnect();
  }
  clearCommQueue() {
    return this.commService.cleanCommQueue();
  }
  onConnectionEvent(e) {
    return this.commService.onConnectionEvent(e);
  }
  setFeature(e, t) {
    this.features.set(e, t);
  }
  setFileFetchStatus(e, t) {
    this.filesFetchStatus.set(e, t);
  }
  getFileFetchStatus(e) {
    return this.filesFetchStatus.get(e);
  }
  setFirmwareVersion(e) {
    this.info.setFwVersion(e);
  }
}
class Yl {
  constructor(e, t) {
    v(this, "rpcResponse");
    v(this, "fwVersion");
    v(this, "files");
    v(this, "writeBuffers", new Map());
    v(this, "_notifiyResolvers", {});
    v(this, "connectionListener", new pt());
    ((this.rpcResponse = ""),
      (this.fwVersion = t),
      (this.files = new Map(
        e.map((r) => [r.fileName, te.readFileSync(r.filePath)]),
      )));
  }
  onConnectionEvent(e) {
    return this.connectionListener.on(e);
  }
  abortJsonRpcRequest(e) {
    return Promise.resolve();
  }
  addNotifyHandler(e, t) {
    this._notifiyResolvers[e] = t;
  }
  removeNotifyHandler(e) {}
  connect(e) {
    return (
      this.connectionListener.emit({ type: Le.CONNECTED }),
      new Promise((t, r) => setTimeout(() => t(!0), 200))
    );
  }
  connectWithSerial(e) {
    return new Promise((t, r) => setTimeout(() => t(!0), 200));
  }
  connectWithHID(e) {
    return new Promise((t, r) => setTimeout(() => t(!0), 200));
  }
  disconnect() {
    return (
      this.connectionListener.emit({ type: Le.DISCONNECTED }),
      new Promise((e, t) => setTimeout(() => e(), 200))
    );
  }
  isConnected() {
    return !0;
  }
  sendLegacyRpcRequest(e, t) {
    return new Promise(function (r, i) {
      setTimeout(() => {
        r("Legacy rpc request received");
      }, 100);
    });
  }
  sendJsonRpcRequest(e, t) {
    const r = this.handleJsonRpcCalls(e, t),
      i = JSON.stringify(r);
    return new Promise(function (n, s) {
      setTimeout(() => {
        n(i);
      }, 100);
    });
  }
  handleJsonRpcCalls(e, t) {
    const r = JSON.parse(e),
      i = r.method,
      n = r.params;
    if (i == null) throw "Request does not have a method";
    p.info(
      "|mock_comm_service| Received rpc call with method: " +
        i +
        " and params: " +
        n,
    );
    let s = {},
      l;
    switch (i) {
      case "sys.version":
        s = { version: this.fwVersion };
        break;
      case "fs.list":
        s = [...this.files.keys()].map((c) => {
          const h = this.files.get(c),
            d = _s.createHash("sha1").update(h).digest("hex");
          return { name: c, size: String(h.length), checksum: d };
        });
        break;
      case "fs.readbin": {
        const { file: c, offset: h, len: d } = n ?? {};
        if (c === void 0 || h === void 0 || d === void 0) {
          l = { code: -1, message: "params are not correct" };
          break;
        }
        if (!this.files.has(c)) {
          l = { code: -2, message: `file not found: ${c}` };
          break;
        }
        s = this.handleReadBin(c, h, d);
        break;
      }
      case "fs.writebin": {
        const { file: c, data: h, completed: d = !1 } = n ?? {};
        if (c === void 0 || h === void 0) {
          l = { code: -1, message: "params are not correct" };
          break;
        }
        s = { data_written: this._handleWriteBin(c, h, d) };
        break;
      }
      case "device.status":
        s = { version: this.fwVersion, profile_index: 0, layer_index: 0 };
        break;
    }
    return { id: t, result: s, error: l };
  }
  handleReadBin(e, t, r) {
    const i = this.files.get(e),
      n = Math.min(t + r, i.length),
      s = i.subarray(t, n).toString("base64");
    return { total_size: i.length, data: s };
  }
  _handleWriteBin(e, t, r) {
    const i = Buffer.from(t, "base64"),
      n = this.writeBuffers.get(e) ?? Buffer.alloc(0),
      s = Buffer.concat([n, i]);
    return (
      r
        ? (this.files.set(e, s), this.writeBuffers.delete(e))
        : this.writeBuffers.set(e, s),
      i.length
    );
  }
  cleanCommQueue() {
    this.rpcResponse = "";
  }
  getMockFileContentForTests(e) {
    var t;
    return (t = this.files.get(e)) == null ? void 0 : t.toString("utf-8");
  }
}
class ht extends Oo {
  constructor(t, r, i, n) {
    super(t, r);
    v(this, "win");
    v(this, "btnWin");
    v(this, "files", new Map());
    v(this, "ipcListeners", []);
    const s = { info: p.info, error: p.error, debug: p.debug, warn: p.warn };
    ((this.commService = new Yl(n, i)),
      (this.rpcService = new Pi(this.commService, s)),
      this.createDeviceFeatures(),
      this.createNotifyListeners(),
      this.features.get(Z.radialMenu) && this.createDevJoystick(),
      this.createDevButtons());
  }
  registerIpc(t, r) {
    (N.on(t, r), this.ipcListeners.push({ channel: t, listener: r }));
  }
  destroy() {
    var t, r, i, n;
    for (const { channel: s, listener: l } of this.ipcListeners)
      N.removeListener(s, l);
    ((this.ipcListeners = []),
      ((t = this.win) != null && t.isDestroyed()) ||
        (r = this.win) == null ||
        r.close(),
      ((i = this.btnWin) != null && i.isDestroyed()) ||
        (n = this.btnWin) == null ||
        n.close(),
      (this.win = void 0),
      (this.btnWin = void 0));
  }
  async createDevJoystick() {
    if (this.win) return;
    (p.info("|mock_device| creating dev joystick window"),
      (this.win = new Ve({
        width: 300,
        height: 300,
        backgroundColor: "#00000000",
        webPreferences: { nodeIntegration: !0, contextIsolation: !1 },
      })));
    const t = ue(
      process.env.DIST,
      "..",
      "electron",
      "data",
      "mocks",
      "joystick.html",
    );
    (this.win.loadFile(t),
      this.registerIpc("joystick-move", (r, { angle: i, distance: n }) => {
        var c;
        let s = 0;
        n > 0.7 ? (s = 2) : n > 0.2 && (s = 1);
        let l = { a: i, d: n, s: 3, p: 0, l: 0, o: s };
        (n == 1 && (l = { a: i, d: n, s: 3, o: 0, p: 0, l: 0 }),
          (c = this.notifyRouter) == null || c.call(this, L.radialMenu, l));
      }));
  }
  getMockFileContentForTests(t) {
    return this.commService.getMockFileContentForTests(t);
  }
  async createDevButtons() {
    if (this.btnWin) return;
    (p.info("|MockDevice| creating dev buttons window"),
      (this.btnWin = new Ve({
        width: 280,
        height: 280,
        title: "Mock Buttons",
        webPreferences: { nodeIntegration: !0, contextIsolation: !1 },
      })));
    const t = ue(
      process.env.DIST,
      "..",
      "electron",
      "data",
      "mocks",
      "buttons.html",
    );
    (this.btnWin.loadFile(t),
      this.registerIpc("mock-button-1", async () => {
        var i;
        await new Promise((n, s) => setTimeout(() => n(!0), 1e3));
        const r = {
          text: `Testing this stupid feature of text insert, I love to Insert stuff
 even on multiple lines`,
        };
        (i = this.notifyRouter) == null || i.call(this, L.insertText, r);
      }),
      this.registerIpc("mock-button-2", () => {
        var i;
        const r = { url: "www.google.com" };
        (i = this.notifyRouter) == null || i.call(this, L.operUrl, r);
      }),
      this.registerIpc("mock-button-3", () => {
        var i;
        const r = { path: "/System/Applications/App Store.app" };
        (i = this.notifyRouter) == null || i.call(this, L.openApplication, r);
      }),
      this.registerIpc("mock-button-4", () => {
        var i;
        const r = { cmd: "ls -la" };
        (i = this.notifyRouter) == null || i.call(this, L.execCmd, r);
      }));
  }
}
class ql extends ht {
  constructor(e) {
    const t = new le("", "33428", Ie.ConnectionType.hid, U.NomadE, Ne.ansi, !0),
      r = "0.9.0",
      i = fe(__dirname, "../../electron/data/mocks/nomad_e"),
      n = [
        { fileName: "keymap.json", filePath: fe(i, "nomad_mock_keymap.json") },
        {
          fileName: "smart_actions.json",
          filePath: fe(i, "smart_actions.json"),
        },
      ];
    super(e, t, r, n);
  }
}
class Zl extends ht {
  constructor(e) {
    const t = new le("", "33507", Ie.ConnectionType.hid, U.Knob, Ne.ansi, !0),
      r = "0.3.0",
      i = fe(__dirname, "../../electron/data/mocks/knob"),
      n = [
        { fileName: "keymap.json", filePath: fe(i, "knob_mock_keymap.json") },
      ];
    super(e, t, r, n);
  }
}
class Ql extends ht {
  constructor(e) {
    const t = new le("", "33686", Ie.ConnectionType.hid, U.KnobF1, Ne.ansi, !0),
      r = "0.4.1",
      i = fe(__dirname, "framer_f1_mock_keymap.json"),
      n = fe(
        process.env.DIST ?? "",
        "..",
        "electron",
        "data",
        "mocks",
        "knob_f1",
        "framer_f1_mock_keymap.json",
      ),
      s = [{ fileName: "keymap.json", filePath: ys(i) ? i : n }];
    super(e, t, r, s);
  }
}
class ed extends ht {
  constructor(e) {
    const t = new le(
        "",
        "33432",
        Ie.ConnectionType.hid,
        U.CreatorMicroV2,
        Ne.universal,
        !0,
      ),
      r = "v0.5.0-rc.1",
      i = fe(__dirname, "../../electron/data/mocks/c_micro_v2"),
      n = [
        {
          fileName: "keymap.json",
          filePath: fe(i, "creator_micro_mock_keymap.json"),
        },
      ];
    super(e, t, r, n);
  }
}
class td extends ht {
  constructor(e) {
    const t = new le("", "33606", Ie.ConnectionType.hid, U.XYZ, Ne.ansi, !0),
      r = "0.1.0",
      i = fe(__dirname, "../../electron/data/mocks/xyz"),
      n = [
        { fileName: "keymap.json", filePath: fe(i, "xyz_mock_keymap.json") },
      ];
    super(e, t, r, n);
  }
}
class rd extends ht {
  constructor(e) {
    const t = new le(
        "",
        "33792",
        Ie.ConnectionType.hid,
        U.CodexMicro,
        Ne.universal,
        !0,
      ),
      r = "0.1.0",
      i = fe(__dirname, "../../electron/data/mocks/codex_micro"),
      n = [
        {
          fileName: "keymap.json",
          filePath: fe(i, "codex_micro_mock_keymap.json"),
        },
      ];
    super(e, t, r, n);
  }
}
class id {
  constructor() {
    v(this, "devices", new Map());
    v(this, "deviceUnsub", new Map());
    v(this, "lastId", 0);
    v(this, "connEventEmitter", new pt());
    v(this, "notifyEventEmitter", new pt());
    v(this, "fileFetchEventEmitter", new pt());
  }
  getDevices() {
    return this.devices.values().toArray();
  }
  getDevice(e) {
    return this.devices.get(e);
  }
  onConnectionEvent(e) {
    return this.connEventEmitter.on(e);
  }
  onNotifyEvent(e) {
    return this.notifyEventEmitter.on(e);
  }
  onFileFetchEvent(e) {
    return this.fileFetchEventEmitter.on(e);
  }
  async onDevicesFound(e) {
    p.info("|devices_comm_manager| found new device");
    const t = new Set(e.map((i) => this.deviceIdentityKey(i)));
    process.env.DEV_MODE === "true" &&
      this.getMockDevices().forEach((i) => {
        t.add(this.deviceIdentityKey(i));
      });
    for (const [i, n] of this.devices.entries()) {
      const s = this.deviceIdentityKey(n.info);
      t.has(s) ||
        (p.warn(
          `|devices_comm_manager| device ${i} (${n.info.deviceType}) no longer present, removing`,
        ),
        await this.removeDevice(i));
    }
    for (const i of e) await this.connectToDevice(i);
    let r = [];
    (this.devices.forEach((i, n) => {
      r.push(sr.fromDeviceInfo(n, i.isConnected(), i.info));
    }),
      m.get().windowService.sendDataToMainWin(Ae.onDevicesFound, r));
  }
  async connectToAllFoundDevices() {
    process.env.DEV_MODE === "true" && this.addMockDevices();
  }
  async connectToDevice(e) {
    const t = [...this.devices.values()].find((n) =>
      this.areDevicesEqual(n.info, e),
    );
    if (t) {
      if (t.isConnected()) return;
      await this.removeDevice(t.id);
    }
    const r = ++this.lastId,
      i = new Oo(r, e);
    if (
      (this.devices.set(r, i), this.attachDeviceEvents(i), !(await i.connect()))
    ) {
      p.error(`|devices_comm_manager| failed to connect to device ${r}`);
      return;
    }
  }
  attachDeviceEvents(e) {
    const t = e.onConnectionEvent(async (r) => {
      const i = { deviceId: e.id, ...r };
      (r.type === Le.CONNECTED
        ? await this.onDeviceConnected(e)
        : this.onDeviceDisconnected(e),
        this.connEventEmitter.emit(i));
    });
    (e.setNotifyRouter((r, i) => {
      try {
        this.notifyEventEmitter.emit({ deviceId: e.id, method: r, params: i });
      } catch (n) {
        this.notifyEventEmitter.emit({ deviceId: e.id, method: r, error: n });
      }
    }),
      this.deviceUnsub.set(e.id, t));
  }
  async onDeviceConnected(e) {
    try {
      const t = await e.rpcService.getFirmwareVersion();
      e.setFirmwareVersion(t);
      const r = await m
        .get()
        .deviceFlashService.checkForFwUpdates(t, e.info.deviceType);
      e.updateInfo = r;
    } catch (t) {
      p.error(
        `|devices_comm_manager| cannot get fw version of valid device ${t}`,
      );
    }
    switch (e.info.deviceType) {
      case U.CreatorMicroV2:
        m.get().windowService.createRadialMenuWindow();
        break;
      case U.CodexMicro:
        m.get().windowService.createRadialMenuWindow();
        break;
    }
  }
  onDeviceDisconnected(e) {
    switch (e.info.deviceType) {
      case U.CreatorMicroV2:
      case U.CodexMicro:
        if (this.hasConnectedSharedWindowDevice(e.id)) break;
        (m.get().windowService.closeRadialMenu(),
          m.get().windowService.closeCheatSheetWin());
        break;
    }
  }
  hasConnectedSharedWindowDevice(e) {
    return [...this.devices.values()].some(
      (t) =>
        t.id !== e &&
        t.isConnected() &&
        (t.info.deviceType === U.CreatorMicroV2 ||
          t.info.deviceType === U.CodexMicro),
    );
  }
  async disconnectAllDevices() {
    for (const e of this.devices) await this.removeDevice(e[0]);
    this.devices = new Map();
  }
  async registerDeviceForIntegrationTest(e) {
    (this.devices.has(e.id) && (await this.removeDevice(e.id)),
      this.devices.set(e.id, e),
      this.attachDeviceEvents(e));
  }
  deviceIdentityKey(e) {
    return JSON.stringify({
      devicePid: e.devicePid,
      connectionType: e.connectionType,
      deviceType: e.deviceType,
      layoutType: e.layoutType,
      portPath: e.portPath,
    });
  }
  areDevicesEqual(e, t) {
    return this.deviceIdentityKey(e) === this.deviceIdentityKey(t);
  }
  async removeDevice(e) {
    const t = this.devices.get(e);
    if (!t) return;
    (p.info(`|devices_comm_manager| removing device ${e}`),
      await t.disconnect().catch(() => {}));
    const r = this.deviceUnsub.get(e);
    (r && (r(), this.deviceUnsub.delete(e)), this.devices.delete(e));
  }
  setDeviceFeature(e, t, r) {
    var i;
    (i = this.devices.get(e)) == null || i.setFeature(t, r);
  }
  setFileFetchStatus(e, t, r) {
    var i;
    ((i = this.devices.get(e)) == null || i.setFileFetchStatus(t, r),
      this.fileFetchEventEmitter.emit({
        deviceId: e,
        fileName: t,
        fetchStatus: r,
      }));
  }
  async addMockDevices() {
    if (process.env.DEV_MODE === "true") {
      if (process.env.MOCK_NOMAD_E === "true") {
        p.info("|devices_comm_manager| creating mock nomad_e device");
        const e = ++this.lastId,
          t = new ql(e);
        (this.devices.set(e, t), this.attachDeviceEvents(t), await t.connect());
      }
      if (process.env.MOCK_KNOB_1 === "true") {
        p.info("|devices_comm_manager| creating mock knob_1 device");
        const e = ++this.lastId,
          t = new Zl(e);
        (this.devices.set(e, t), this.attachDeviceEvents(t), await t.connect());
      }
      if (process.env.MOCK_FRAMER_F1 === "true") {
        p.info("|devices_comm_manager| creating mock Framer F1 device");
        const e = ++this.lastId,
          t = new Ql(e);
        (this.devices.set(e, t), this.attachDeviceEvents(t), await t.connect());
      }
      if (process.env.MOCK_C_MICRO_V2 === "true") {
        p.info("|devices_comm_manager| creating mock creator_micro_v2 device");
        const e = ++this.lastId,
          t = new ed(e);
        (this.devices.set(e, t), this.attachDeviceEvents(t), await t.connect());
      }
      if (process.env.MOCK_XYZ === "true") {
        p.info("|devices_comm_manager| creating mock xyz device");
        const e = ++this.lastId,
          t = new td(e);
        (this.devices.set(e, t), this.attachDeviceEvents(t), await t.connect());
      }
      if (process.env.MOCK_CODEX_MICRO === "true") {
        p.info("|devices_comm_manager| creating mock codex_micro device");
        const e = ++this.lastId,
          t = new rd(e);
        (this.devices.set(e, t), this.attachDeviceEvents(t), await t.connect());
      }
    }
  }
  getMockDevices() {
    let e = [];
    if (process.env.MOCK_NOMAD_E === "true") {
      const t = new le(
        "",
        "33428",
        Ie.ConnectionType.hid,
        U.NomadE,
        Ne.ansi,
        !0,
      );
      e.push(t);
    }
    if (process.env.MOCK_KNOB_1 === "true") {
      const t = new le("", "33507", Ie.ConnectionType.hid, U.Knob, Ne.ansi, !0);
      e.push(t);
    }
    if (process.env.MOCK_FRAMER_F1 === "true") {
      const t = new le(
        "",
        "33686",
        Ie.ConnectionType.hid,
        U.KnobF1,
        Ne.ansi,
        !0,
      );
      e.push(t);
    }
    if (process.env.MOCK_C_MICRO_V2 === "true") {
      const t = new le(
        "",
        "33432",
        Ie.ConnectionType.hid,
        U.CreatorMicroV2,
        Ne.universal,
        !0,
      );
      e.push(t);
    }
    if (process.env.MOCK_XYZ === "true") {
      const t = new le("", "33606", Ie.ConnectionType.hid, U.XYZ, Ne.ansi, !0);
      e.push(t);
    }
    if (process.env.MOCK_CODEX_MICRO === "true") {
      const t = new le(
        "",
        "33792",
        Ie.ConnectionType.hid,
        U.CodexMicro,
        Ne.universal,
        !0,
      );
      e.push(t);
    }
    return e;
  }
}
var Ko = ((o) => (
  (o.unknown = "unknown"),
  (o.mediaWidget = "media-player"),
  o
))(Ko || {});
class od {
  constructor() {
    this.onDeviceConnected();
  }
  onDeviceConnected() {
    const e = m.get().devicesCommManager;
    e.onConnectionEvent((t) => {
      const r = e.getDevice(t.deviceId);
      !r || t.type !== Le.CONNECTED || this.checkDeviceScreeen(r);
    });
  }
  async checkDeviceScreeen(e) {
    if (e.info.deviceType != U.NomadE && e.info.deviceType !== U.NomadEV2)
      return;
    const t = await e.rpcService.getDeviceCurrentScreen();
    (p.info("|device_screen_service| current device screen is: " + t),
      t !== void 0 &&
        t === Ko.mediaWidget &&
        (m.get().devicesCommManager.setDeviceFeature(e.id, Z.mediaPlayer, !0),
        m.get().mediaPlayerService.startMediaFetching()));
  }
}
var he = ((o) => (
  (o[(o.notFetched = 0)] = "notFetched"),
  (o[(o.fetching = 1)] = "fetching"),
  (o[(o.fetched = 2)] = "fetched"),
  (o[(o.error = 3)] = "error"),
  o
))(he || {});
const Fo = "wallpaper_bg.bin",
  Ao = "wallpapers/wallpaper_bg.bin",
  Br = "wallpapers/wallpaper_bg.gif",
  ut = "keymap.json",
  ir = "smart_actions.json";
class Xr {
  constructor(e, t, r) {
    v(this, "name");
    v(this, "size");
    v(this, "checksum");
    ((this.name = e), (this.size = t), (this.checksum = r));
  }
  static fromWlFileSummary(e) {
    return new Xr(e.name, e.size, e.checksum);
  }
}
var Tt = ((o) => ((o.static = "static"), (o.gif = "gif"), o))(Tt || {});
const nd = [Fo, Ao, Br];
function Gr(o) {
  return nd.includes(o);
}
function sd(o) {
  if (Gr(o)) return o === Br ? Tt.gif : Tt.static;
}
function Mo(o) {
  return o === Tt.gif ? "image/gif" : "image/png";
}
const Po = new Map([
    [ir, 0],
    [ut, 1],
    [Fo, 2],
    [Ao, 2],
    [Br, 3],
  ]),
  Ro = 5,
  ad = 2e4,
  cd = new Set([ut, ir]);
class ld {
  constructor() {
    this.handleDeviceConnection();
  }
  async handleDeviceConnection() {
    const e = m.get().devicesCommManager;
    e.onConnectionEvent(async (t) => {
      if (t.type !== Le.CONNECTED) return;
      const r = e.getDevice(t.deviceId);
      if (!r) {
        p.error("|device_file_service| cannot get connected device");
        return;
      }
      this.fetchDeviceFiles(r);
    });
  }
  async fetchDeviceFiles(e) {
    p.info("|device_file_service| fetch device files");
    const t = await this.getFilteredFileList(e);
    let r = await this.resolveFilesToFetch(e, t);
    if (r.length !== 0) {
      r = r.sort((i, n) => (Po.get(i.name) ?? Ro) - (Po.get(n.name) ?? Ro));
      for (let i = 0; i < r.length; i++) {
        const n = r[i];
        if (!n.checksum) {
          (p.error("|device_file_service| file has no checksum, skipping it"),
            m
              .get()
              .devicesCommManager.setFileFetchStatus(e.id, n.name, he.error));
          continue;
        }
        await this.fetchDeviceFile(e, n.name, n.checksum);
      }
    }
  }
  async resolveFilesToFetch(e, t) {
    p.info("|device_file_service| getting storage data");
    const r = m.get().storageService.getDeviceConfig(e.info.devicePid);
    if (!r)
      return (
        p.info(
          "|device_file_service| no data found for this device, we have to fetch everything",
        ),
        t
      );
    let i = [],
      n = Ge.fromDTO(r);
    return (
      (i = t.filter(
        (s) =>
          !n.files.find(
            (l) => s.name === l.fileName && s.checksum === l.checksum,
          ),
      )),
      await this.pruneRemovedFiles(e, n, t),
      i.length === 0
        ? (p.info(
            "|device_file_service| config is the same as the one on the device, nothing to fetch",
          ),
          t.forEach((s) => {
            m.get().devicesCommManager.setFileFetchStatus(
              e.id,
              s.name,
              he.fetched,
            );
          }),
          [])
        : (t
            .filter((s) => i.find((l) => l.name == s.name) === void 0)
            .forEach((s) => {
              m.get().devicesCommManager.setFileFetchStatus(
                e.id,
                s.name,
                he.fetched,
              );
            }),
          i)
    );
  }
  async fetchDeviceFile(e, t, r) {
    try {
      (p.info(`|device_file_service| fetching ${t}`),
        m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.fetching));
      const i = await this.readDeviceFile(e, t);
      if (!i) {
        (p.error("|device_file_service| could not fetch file"),
          m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error));
        return;
      }
      let n = i,
        s = r;
      if (t === ir) {
        const l = m.get().deviceKeymapService.parseSmartActionsFile(e, i);
        if (!l) {
          (p.error(
            "|device_file_service| smart actions.json is undefined there has been an error",
          ),
            m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error));
          return;
        }
        this.updateDeviceConfigForSmartActions(
          e.info,
          l.smartActions,
          l.smartActionGroups,
        );
      }
      if (t === ut) {
        const l = await m.get().deviceKeymapService.parseKeymapFile(e, i);
        if (!l) {
          (p.error(
            "|device_file_service| keymap.json is undefined there has been an error",
          ),
            m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error));
          return;
        }
        if (l.migrated) {
          const c = await this.readDeviceFile(e, ut);
          if (!c) {
            (p.error("|device_file_service| could not read migrated keymap"),
              m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error));
            return;
          }
          const h = await this.verifyMigratedKeymap(e, c);
          if (!h) {
            m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error);
            return;
          }
          ((n = c), (s = h));
        }
        this.updateDeviceConfigForKeymap(e.info.devicePid, l.deviceConfig);
      }
      if (!(await m.get().fsService.saveDeviceFile(e.info.devicePid, t, n))) {
        (p.error("|device_file_service| failed to save file"),
          m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error));
        return;
      }
      (this.updateDeviceFileConfig(e.info.devicePid, t, s),
        m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.fetched));
    } catch (i) {
      (p.error("|device_file_service| error while fetching file, error: " + i),
        m.get().devicesCommManager.setFileFetchStatus(e.id, t, he.error));
    }
  }
  async readDeviceFile(e, t) {
    const r = e.rpcService.readFileChunked(t);
    return cd.has(t)
      ? this.withTimeout(r, ad, `timed out fetching ${t}`, () =>
          e.clearCommQueue(),
        )
      : r;
  }
  async verifyMigratedKeymap(e, t) {
    const r = Dr.createHash("sha1").update(t).digest("hex"),
      i = (await e.rpcService.getFileList()).find((n) => n.name === ut);
    if ((i == null ? void 0 : i.checksum) !== r) {
      p.error(
        "|device_file_service| migrated keymap checksum does not match the device",
      );
      return;
    }
    return i.checksum;
  }
  async withTimeout(e, t, r, i) {
    let n;
    const s = new Promise((l, c) => {
      n = setTimeout(() => {
        try {
          i();
        } catch (h) {
          p.error(`|device_file_service| timeout cleanup failed: ${h}`);
        }
        c(new Error(r));
      }, t);
    });
    try {
      return await Promise.race([e, s]);
    } finally {
      n !== void 0 && clearTimeout(n);
    }
  }
  async fetchWallpaper(e) {
    const t = (await e.rpcService.getFileList()).find((r) => Gr(r.name));
    if (t != null && t.checksum)
      return this.fetchDeviceFile(e, t.name, t.checksum);
  }
  async deleteWallpapers(e) {
    p.info("|device_file_service| deleting wallpaper");
    const t = m.get().devicesCommManager.getDevice(e);
    if (!t) return (p.error("|device_file_service| cannot find device"), !1);
    try {
      const r = (await t.rpcService.getFileList())
        .map((n) => n.name)
        .filter(Gr);
      if (r.length === 0) return !0;
      let i = !0;
      for (const n of r) {
        if (!(await t.rpcService.deleteFile(n))) {
          (p.error(`|device_file_service| failed to delete ${n} from device`),
            (i = !1));
          continue;
        }
        ((await m.get().fsService.deleteDeviceFile(t.info.devicePid, n))
          ? this.removeFileFromFileConfig(t.info.devicePid, n)
          : (i = !1),
          m.get().devicesCommManager.setFileFetchStatus(e, n, he.notFetched));
      }
      return i;
    } catch (r) {
      return (
        p.error(`|device_file_service| failed to delete wallpaper: ${r}`),
        !1
      );
    }
  }
  async addWallpaper(e, t, r) {
    p.info("|device_file_service| adding wallpaper");
    const i = m.get().devicesCommManager.getDevice(e);
    if (!i) return (p.error("|device_file_service| cannot find device"), !1);
    try {
      const n = r.toLowerCase().endsWith(".gif")
          ? t
          : await m.get().imageService.convertToLvglFormat(t),
        s = Dr.createHash("sha1").update(n).digest("hex");
      if (!(await this.deleteWallpapers(i.id)))
        return (p.error("|device_file_service| failed delete wallpapers"), !1);
      if (
        (await m.get().fsService.deleteDeviceFile(i.info.devicePid, r),
        this.removeFileFromFileConfig(i.info.devicePid, r),
        !(await i.rpcService.writeFileChunked(r, n)))
      )
        return (
          p.error("|device_file_service| failed to write wallpaper"),
          m.get().devicesCommManager.setFileFetchStatus(e, r, he.error),
          !1
        );
      const l = (await i.rpcService.getFileList()).find((c) => c.name === r);
      return !(l != null && l.checksum) || l.checksum !== s
        ? (p.error(
            "|device_file_service| wallpaper checksums don't match wallpaper is incorrect",
          ),
          m.get().devicesCommManager.setFileFetchStatus(e, r, he.error),
          !1)
        : !(await m.get().fsService.saveDeviceFile(i.info.devicePid, r, n)) ||
            !this.updateDeviceFileConfig(i.info.devicePid, r, l.checksum)
          ? (m.get().devicesCommManager.setFileFetchStatus(e, r, he.error), !1)
          : (m.get().devicesCommManager.setFileFetchStatus(e, r, he.fetched),
            !0);
    } catch (n) {
      return (
        p.error(`|device_file_service| failed to add wallpaper: ${n}`),
        m.get().devicesCommManager.setFileFetchStatus(e, r, he.error),
        !1
      );
    }
  }
  async getFilteredFileList(e) {
    return (await e.rpcService.getFileList())
      .filter((t) =>
        t.size === 0 || t.name === "null" || t.name.startsWith("tmp")
          ? (p.warn(
              "|device_file_service| removed file with name null or empty",
            ),
            !1)
          : !0,
      )
      .map((t) => Xr.fromWlFileSummary(t));
  }
  async pruneRemovedFiles(e, t, r) {
    const i = t.files.filter((n) => !r.find((s) => s.name === n.fileName));
    ((t.files = t.files.filter((n) => r.find((s) => s.name === n.fileName))),
      m.get().storageService.saveDeviceConfig(e.info.devicePid, t.toDTO()));
    for (const n of i)
      try {
        (await m.get().fsService.deleteDeviceFile(e.info.devicePid, n.fileName),
          m
            .get()
            .devicesCommManager.setFileFetchStatus(
              e.id,
              n.fileName,
              he.notFetched,
            ));
      } catch (s) {
        p.error(
          `|device_file_service| failed to delete pruned file ${n.fileName}: ${s}`,
        );
      }
  }
  updateDeviceConfigForKeymap(e, t) {
    var i, n;
    let r = m.get().storageService.getDeviceConfig(e);
    (r &&
      ((t.files = r.files),
      (t.smartActions =
        (i = r.smartActions) == null ? void 0 : i.map((s) => Re.fromDTO(s))),
      (t.smartActionGroups =
        (n = r.smartActionGroups) == null
          ? void 0
          : n.map((s) => Te.fromDTO(s)))),
      m.get().storageService.saveDeviceConfig(e, t.toDTO()));
  }
  updateDeviceConfigForSmartActions(e, t, r) {
    let i = m.get().storageService.getDeviceConfig(e.devicePid);
    (i ||
      (i = {
        device: e.toDTO(),
        files: [],
        activeProfileId: 0,
        profiles: [],
        actions: [],
        actionGroups: [],
        multiactions: [],
        multiactionGroups: [],
      }),
      (i.smartActions = t.map((n) => n.toDTO())),
      (i.smartActionGroups = r.map((n) => n.toDTO())),
      m.get().storageService.saveDeviceConfig(e.devicePid, i));
  }
  updateDeviceFileConfig(e, t, r) {
    let i = m.get().storageService.getDeviceConfig(e);
    return i
      ? (i.files.find((n) => n.fileName === t)
          ? i.files.forEach((n) => {
              n.fileName === t && (n.checksum = r);
            })
          : i.files.push({ fileName: t, checksum: r }),
        m.get().storageService.saveDeviceConfig(e, i))
      : (p.error("|device_file_service| cannot find device config"), !1);
  }
  removeFileFromFileConfig(e, t) {
    let r = m.get().storageService.getDeviceConfig(e);
    return r
      ? ((r.files = r.files.filter((i) => i.fileName !== t)),
        m.get().storageService.saveDeviceConfig(e, r))
      : (p.error("|device_file_service| cannot find device config"), !1);
  }
}
const dd = 1,
  pd = 0,
  hd = [
    {
      name: "Default",
      layers: [
        {
          id: -100,
          name: "fp",
          color: 16711680,
          layout: {
            encoders: [
              ["KC_NONE", "KC_NONE"],
              ["KC_NONE", "KC_NONE"],
              ["KC_NONE", "KC_NONE"],
            ],
            buttons: [["KC_NONE", "KC_NONE", "KC_NONE", "KC_NONE"]],
            keymap: [
              [
                "KC_NONE",
                "KC_BRID",
                "KC_BRIU",
                "KC_NONE",
                "KC_NONE",
                "KI_BLDW",
                "KI_BLUP",
                "KC_MPRV",
                "KC_MPLY",
                "KC_MNXT",
                "KC_MUTE",
                "KC_VOLD",
                "KC_VOLU",
                "KV_FRAMER_PUBLISH",
              ],
              [
                "KC_NONE",
                "KA_M0",
                "KA_M1",
                "KA_M2",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
              ],
              [
                "KC_NONE",
                "KI_CBTP1",
                "KI_CBTP2",
                "KI_CBTP3",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
              ],
              [
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
              ],
              [
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
                "KC_NONE",
              ],
              [
                "KC_LCTL",
                "KI_FP",
                "KC_LALT",
                "KC_LGUI",
                "KC_SPC",
                "KC_RCTL",
                "KI_FP",
                "KC_LEFT",
                "KC_DOWN",
                "KC_RGHT",
              ],
            ],
          },
          os: 0,
        },
        {
          id: 0,
          name: "Layer",
          color: 16711680,
          layout: {
            encoders: [
              ["KC_VOLU", "KC_VOLD"],
              ["KC_NONE", "KC_NONE"],
              ["KC_NONE", "KC_NONE"],
            ],
            buttons: [["KC_NONE", "KC_NONE", "KC_NONE", "KC_NONE"]],
            keymap: [
              [
                "KC_ESC",
                "KC_F1",
                "KC_F2",
                "KC_F3",
                "KC_F4",
                "KC_F5",
                "KC_F6",
                "KC_F7",
                "KC_F8",
                "KC_F9",
                "KC_F10",
                "KC_F11",
                "KC_F12",
                "KC_DEL",
              ],
              [
                "KC_GRV",
                "KC_1",
                "KC_2",
                "KC_3",
                "KC_4",
                "KC_5",
                "KC_6",
                "KC_7",
                "KC_8",
                "KC_9",
                "KC_0",
                "KC_MINS",
                "KC_EQL",
                "KC_BSPC",
              ],
              [
                "KC_TAB",
                "KC_Q",
                "KC_W",
                "KC_E",
                "KC_R",
                "KC_T",
                "KC_Y",
                "KC_U",
                "KC_I",
                "KC_O",
                "KC_P",
                "KC_LBRC",
                "KC_RBRC",
                "KC_BSLS",
              ],
              [
                "KC_CAPS",
                "KC_A",
                "KC_S",
                "KC_D",
                "KC_F",
                "KC_G",
                "KC_H",
                "KC_J",
                "KC_K",
                "KC_L",
                "KC_SCLN",
                "KC_QUOT",
                "KC_ENT",
              ],
              [
                "KC_LSFT",
                "KC_Z",
                "KC_X",
                "KC_C",
                "KC_V",
                "KC_B",
                "KC_N",
                "KC_M",
                "KC_COMM",
                "KC_DOT",
                "KC_SLSH",
                "KC_RSFT",
                "KC_UP",
              ],
              [
                "KC_LCTL",
                "KI_FP",
                "KC_LALT",
                "KC_LGUI",
                "KC_SPC",
                "KV_FRAMER_AI",
                "KI_FP",
                "KC_LEFT",
                "KC_DOWN",
                "KC_RGHT",
              ],
            ],
          },
          os: 0,
        },
      ],
      multiActionsUsed: [0, 1, 2],
    },
  ],
  ud = [
    {
      id: 0,
      name: "FP-BLE1",
      kcOnTap: "KI_CBT1",
      kcOnHold: "KI_CBTP1",
      kcOnDoubleTap: "KC_NONE",
      kcOnTapHold: "KC_NONE",
    },
    {
      id: 1,
      name: "FP-BLE2",
      kcOnTap: "KI_CBT2",
      kcOnHold: "KI_CBTP2",
      kcOnDoubleTap: "KC_NONE",
      kcOnTapHold: "KC_NONE",
    },
    {
      id: 2,
      name: "FP-BLE3",
      kcOnTap: "KI_CBT3",
      kcOnHold: "KI_CBTP3",
      kcOnDoubleTap: "KC_NONE",
      kcOnTapHold: "KC_NONE",
    },
  ],
  fd = [],
  md = {
    version: dd,
    activeProfileId: pd,
    profiles: hd,
    multiActions: ud,
    macros: fd,
  },
  vd = [
    {
      id: 0,
      name: "Layer",
      color: "#FF0000",
      layout: {
        encoders: [
          [{ keycode: "KC_VOLU" }, { keycode: "KC_VOLD" }],
          [{ keycode: "KC_PGUP" }, { keycode: "KC_PGDN" }],
        ],
        base: [
          [
            { keycode: "KC_ESC", alignItems: "flex-start", width: 79 },
            { keycode: "KC_BRID" },
            { keycode: "KC_BRIU" },
            { keycode: "KA_0" },
            { keycode: "KA_1" },
            { keycode: "KC_F5" },
            { keycode: "KC_F6" },
            { keycode: "KC_MPRV" },
            { keycode: "KC_MPLY" },
            { keycode: "KC_MNXT" },
            { keycode: "KC_MUTE" },
            { keycode: "KC_VOLD" },
            { keycode: "KC_VOLU" },
            { keycode: "KA_2", alignItems: "flex-start", width: 79 },
          ],
          [
            { keycode: "KC_GRV" },
            { keycode: "KC_1" },
            { keycode: "KC_2" },
            { keycode: "KC_3" },
            { keycode: "KC_4" },
            { keycode: "KC_5" },
            { keycode: "KC_6" },
            { keycode: "KC_7" },
            { keycode: "KC_8" },
            { keycode: "KC_9" },
            { keycode: "KC_0" },
            { keycode: "KC_MINS" },
            { keycode: "KC_EQL" },
            { keycode: "KC_BSPC", alignItems: "flex-start", width: 106 },
          ],
          [
            { keycode: "KC_TAB", alignItems: "flex-start", width: 92 },
            { keycode: "KC_Q" },
            { keycode: "KC_W" },
            { keycode: "KC_E" },
            { keycode: "KC_R" },
            { keycode: "KC_T" },
            { keycode: "KC_Y" },
            { keycode: "KC_U" },
            { keycode: "KC_I" },
            { keycode: "KC_O" },
            { keycode: "KC_P" },
            { keycode: "KC_LBRC" },
            { keycode: "KC_RBRC" },
            { keycode: "KC_BSLS", width: 66 },
          ],
          [
            { keycode: "KC_CAPS", alignItems: "flex-start", width: 106 },
            { keycode: "KC_A" },
            { keycode: "KC_S" },
            { keycode: "KC_D" },
            { keycode: "KC_F" },
            { keycode: "KC_G" },
            { keycode: "KC_H" },
            { keycode: "KC_J" },
            { keycode: "KC_K" },
            { keycode: "KC_L" },
            { keycode: "KC_SCLN" },
            { keycode: "KC_QUOT" },
            { keycode: "KC_ENT", alignItems: "flex-start", width: 106 },
          ],
          [
            { keycode: "KC_LSFT", alignItems: "flex-start", width: 120 },
            { keycode: "KC_Z" },
            { keycode: "KC_X" },
            { keycode: "KC_C" },
            { keycode: "KC_V" },
            { keycode: "KC_B" },
            { keycode: "KC_N" },
            { keycode: "KC_M" },
            { keycode: "KC_COMM" },
            { keycode: "KC_DOT" },
            { keycode: "KC_SLSH" },
            { keycode: "KC_RSFT", alignItems: "flex-start", width: 92 },
            { keycode: "KC_UP" },
          ],
          [
            { keycode: "KC_LCTL", alignItems: "flex-start" },
            { keycode: "KI_FP", alignItems: "flex-start" },
            { keycode: "KC_LALT", alignItems: "flex-start" },
            { keycode: "KC_LGUI", alignItems: "flex-start", width: 66 },
            { keycode: "KC_SPC", width: 333 },
            { keycode: "KA_3", alignItems: "flex-start" },
            { keycode: "KI_FP", alignItems: "flex-start", width: 81 },
            { keycode: "KC_LEFT" },
            { keycode: "KC_DOWN" },
            { keycode: "KC_RGHT" },
          ],
        ],
      },
      os: 0,
    },
  ],
  gd = {
    id: -100,
    name: "fp",
    color: "#FF0000",
    layout: {
      encoders: [
        [{ keycode: "KC_NONE" }, { keycode: "KC_NONE" }],
        [{ keycode: "KC_NONE" }, { keycode: "KC_NONE" }],
      ],
      base: [
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 79 },
          { keycode: "KC_F1" },
          { keycode: "KC_F2" },
          { keycode: "KC_F3" },
          { keycode: "KC_F4" },
          { keycode: "KC_F5" },
          { keycode: "KC_F6" },
          { keycode: "KC_F7" },
          { keycode: "KC_F8" },
          { keycode: "KC_F9" },
          { keycode: "KC_F10" },
          { keycode: "KC_F11" },
          { keycode: "KC_F12" },
          { keycode: "KC_DEL", alignItems: "flex-start", width: 79 },
        ],
        [
          { keycode: "KC_NONE" },
          { keycode: "KM_0" },
          { keycode: "KM_1" },
          { keycode: "KM_2" },
          { keycode: "KI_CUSB" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", alignItems: "flex-start", width: 106 },
        ],
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 92 },
          { keycode: "KI_LS1" },
          { keycode: "KI_LS2" },
          { keycode: "KI_LS3" },
          { keycode: "KI_LS4" },
          { keycode: "KI_LS5" },
          { keycode: "KI_LS6" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", width: 66 },
        ],
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 106 },
          { keycode: "KI_PS1" },
          { keycode: "KI_PS2" },
          { keycode: "KI_PS3" },
          { keycode: "KI_PS4" },
          { keycode: "KI_PS5" },
          { keycode: "KI_PS6" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", alignItems: "flex-start", width: 106 },
        ],
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 120 },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", alignItems: "flex-start", width: 92 },
          { keycode: "KC_NONE" },
        ],
        [
          { keycode: "KC_LCTL", alignItems: "flex-start" },
          { keycode: "KI_FP", alignItems: "flex-start" },
          { keycode: "KC_LALT", alignItems: "flex-start" },
          { keycode: "KC_LGUI", alignItems: "flex-start", width: 66 },
          { keycode: "KC_SPC", width: 333 },
          { keycode: "KV_FRAMER_AI", alignItems: "flex-start" },
          { keycode: "KI_FP", alignItems: "flex-start", width: 81 },
          { keycode: "KC_LEFT" },
          { keycode: "KC_DOWN" },
          { keycode: "KC_RGHT" },
        ],
      ],
    },
    os: 0,
  },
  yd = [
    {
      id: 0,
      name: "Mission control",
      color: null,
      keyInputs: [
        { keycode: "KC_LCTL", delay: 0, actionType: 1 },
        { keycode: "KC_UP", delay: 0, actionType: 1 },
      ],
    },
    {
      id: 1,
      name: "Spotlight",
      color: null,
      keyInputs: [
        { keycode: "KC_LGUI", delay: 0, actionType: 1 },
        { keycode: "KC_SPC", delay: 0, actionType: 1 },
      ],
    },
    {
      id: 2,
      name: "Framer Publish",
      color: null,
      keyInputs: [
        { keycode: "KC_LGUI", delay: 0, actionType: 1 },
        { keycode: "KC_LSFT", delay: 0, actionType: 1 },
        { keycode: "KC_P", delay: 0, actionType: 1 },
      ],
    },
    {
      id: 3,
      name: "Framer AI",
      color: null,
      keyInputs: [
        { keycode: "KC_LGUI", delay: 0, actionType: 1 },
        { keycode: "KC_J", delay: 0, actionType: 1 },
      ],
    },
  ],
  _d = [
    {
      id: 0,
      name: "FP-BLE1",
      color: null,
      tap: { keycode: "KI_CBT1", delay: 0, actionType: 1 },
      onHold: { keycode: "KI_CBTP1", delay: 0, actionType: 1 },
      doubleTap: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tapHold: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tappingTerms: 250,
    },
    {
      id: 1,
      name: "FP-BLE2",
      color: null,
      tap: { keycode: "KI_CBT2", delay: 0, actionType: 1 },
      onHold: { keycode: "KI_CBTP2", delay: 0, actionType: 1 },
      doubleTap: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tapHold: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tappingTerms: 250,
    },
    {
      id: 2,
      name: "FP-BLE3",
      color: null,
      tap: { keycode: "KI_CBT3", delay: 0, actionType: 1 },
      onHold: { keycode: "KI_CBTP3", delay: 0, actionType: 1 },
      doubleTap: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tapHold: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tappingTerms: 250,
    },
  ],
  wd = { layers: vd, fpLayer: gd, actions: yd, multiactions: _d },
  Cd = [
    {
      id: 0,
      name: "Layer",
      color: "#FF0000",
      layout: {
        encoders: [
          [{ keycode: "KC_VOLU" }, { keycode: "KC_VOLD" }],
          [{ keycode: "KC_PGUP" }, { keycode: "KC_PGDN" }],
        ],
        base: [
          [
            { keycode: "KC_ESC", alignItems: "flex-start", width: 79 },
            { keycode: "KC_F1" },
            { keycode: "KC_F2" },
            { keycode: "KC_F3" },
            { keycode: "KC_F4" },
            { keycode: "KC_F5" },
            { keycode: "KC_F6" },
            { keycode: "KC_F7" },
            { keycode: "KC_F8" },
            { keycode: "KC_F9" },
            { keycode: "KC_F10" },
            { keycode: "KC_F11" },
            { keycode: "KC_F12" },
            { keycode: "KA_2", alignItems: "flex-start", width: 79 },
          ],
          [
            { keycode: "KC_GRV" },
            { keycode: "KC_1" },
            { keycode: "KC_2" },
            { keycode: "KC_3" },
            { keycode: "KC_4" },
            { keycode: "KC_5" },
            { keycode: "KC_6" },
            { keycode: "KC_7" },
            { keycode: "KC_8" },
            { keycode: "KC_9" },
            { keycode: "KC_0" },
            { keycode: "KC_MINS" },
            { keycode: "KC_EQL" },
            { keycode: "KC_BSPC", alignItems: "flex-start", width: 106 },
          ],
          [
            { keycode: "KC_TAB", alignItems: "flex-start", width: 92 },
            { keycode: "KC_Q" },
            { keycode: "KC_W" },
            { keycode: "KC_E" },
            { keycode: "KC_R" },
            { keycode: "KC_T" },
            { keycode: "KC_Y" },
            { keycode: "KC_U" },
            { keycode: "KC_I" },
            { keycode: "KC_O" },
            { keycode: "KC_P" },
            { keycode: "KC_LBRC" },
            { keycode: "KC_RBRC" },
            { keycode: "KC_BSLS", width: 66 },
          ],
          [
            { keycode: "KC_CAPS", alignItems: "flex-start", width: 106 },
            { keycode: "KC_A" },
            { keycode: "KC_S" },
            { keycode: "KC_D" },
            { keycode: "KC_F" },
            { keycode: "KC_G" },
            { keycode: "KC_H" },
            { keycode: "KC_J" },
            { keycode: "KC_K" },
            { keycode: "KC_L" },
            { keycode: "KC_SCLN" },
            { keycode: "KC_QUOT" },
            { keycode: "KC_ENT", alignItems: "flex-start", width: 106 },
          ],
          [
            { keycode: "KC_LSFT", alignItems: "flex-start", width: 120 },
            { keycode: "KC_Z" },
            { keycode: "KC_X" },
            { keycode: "KC_C" },
            { keycode: "KC_V" },
            { keycode: "KC_B" },
            { keycode: "KC_N" },
            { keycode: "KC_M" },
            { keycode: "KC_COMM" },
            { keycode: "KC_DOT" },
            { keycode: "KC_SLSH" },
            { keycode: "KC_RSFT", alignItems: "flex-start", width: 92 },
            { keycode: "KC_UP" },
          ],
          [
            { keycode: "KC_LCTL", alignItems: "flex-start" },
            { keycode: "KI_FP", alignItems: "flex-start" },
            { keycode: "KC_LGUI", alignItems: "flex-start" },
            { keycode: "KC_LALT", alignItems: "flex-start", width: 66 },
            { keycode: "KC_SPC", width: 333 },
            { keycode: "KA_3", alignItems: "flex-start" },
            { keycode: "KI_FP", alignItems: "flex-start", width: 81 },
            { keycode: "KC_LEFT" },
            { keycode: "KC_DOWN" },
            { keycode: "KC_RGHT" },
          ],
        ],
      },
      os: 1,
    },
  ],
  Sd = {
    id: -100,
    name: "fp",
    color: "#FF0000",
    layout: {
      encoders: [
        [{ keycode: "KC_NONE" }, { keycode: "KC_NONE" }],
        [{ keycode: "KC_NONE" }, { keycode: "KC_NONE" }],
      ],
      base: [
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 79 },
          { keycode: "KC_BRID" },
          { keycode: "KC_BRIU" },
          { keycode: "KA_0" },
          { keycode: "KA_1" },
          { keycode: "KC_F5" },
          { keycode: "KC_F6" },
          { keycode: "KC_MPRV" },
          { keycode: "KC_MPLY" },
          { keycode: "KC_MNXT" },
          { keycode: "KC_MUTE" },
          { keycode: "KC_VOLD" },
          { keycode: "KC_VOLU" },
          { keycode: "KC_DEL", alignItems: "flex-start", width: 79 },
        ],
        [
          { keycode: "KC_NONE" },
          { keycode: "KM_0" },
          { keycode: "KM_1" },
          { keycode: "KM_2" },
          { keycode: "KI_CUSB" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", alignItems: "flex-start", width: 106 },
        ],
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 92 },
          { keycode: "KI_LS1" },
          { keycode: "KI_LS2" },
          { keycode: "KI_LS3" },
          { keycode: "KI_LS4" },
          { keycode: "KI_LS5" },
          { keycode: "KI_LS6" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", width: 66 },
        ],
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 106 },
          { keycode: "KI_PS1" },
          { keycode: "KI_PS2" },
          { keycode: "KI_PS3" },
          { keycode: "KI_PS4" },
          { keycode: "KI_PS5" },
          { keycode: "KI_PS6" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", alignItems: "flex-start", width: 106 },
        ],
        [
          { keycode: "KC_NONE", alignItems: "flex-start", width: 120 },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE" },
          { keycode: "KC_NONE", alignItems: "flex-start", width: 92 },
          { keycode: "KC_NONE" },
        ],
        [
          { keycode: "KC_LCTL", alignItems: "flex-start" },
          { keycode: "KI_FP", alignItems: "flex-start" },
          { keycode: "KC_LGUI", alignItems: "flex-start" },
          { keycode: "KC_LALT", alignItems: "flex-start", width: 66 },
          { keycode: "KC_SPC", width: 333 },
          { keycode: "KC_RCTL", alignItems: "flex-start" },
          { keycode: "KI_FP", alignItems: "flex-start", width: 81 },
          { keycode: "KC_LEFT" },
          { keycode: "KC_DOWN" },
          { keycode: "KC_RGHT" },
        ],
      ],
    },
    os: 1,
  },
  kd = [
    {
      id: 0,
      name: "Show-windows",
      color: null,
      os: 1,
      icon: "icon-window-restore-far",
      keyInputs: [
        { keycode: "KC_LGUI", delay: 0, actionType: 1 },
        { keycode: "KC_TAB", delay: 0, actionType: 2 },
      ],
    },
    {
      id: 1,
      name: "Search",
      color: null,
      os: 1,
      keyInputs: [
        { keycode: "KC_LGUI", delay: 0, actionType: 1 },
        { keycode: "KC_Q", delay: 0, actionType: 2 },
      ],
    },
    {
      id: 2,
      name: "Framer Publish",
      color: null,
      keyInputs: [
        { keycode: "KC_LCTL", delay: 0, actionType: 1 },
        { keycode: "KC_LSFT", delay: 0, actionType: 1 },
        { keycode: "KC_P", delay: 0, actionType: 1 },
      ],
    },
    {
      id: 3,
      name: "Framer AI",
      color: null,
      keyInputs: [
        { keycode: "KC_LCTL", delay: 0, actionType: 1 },
        { keycode: "KC_J", delay: 0, actionType: 1 },
      ],
    },
  ],
  Ed = [
    {
      id: 0,
      name: "FP-BLE1",
      color: null,
      tap: { keycode: "KI_CBT1", delay: 0, actionType: 1 },
      onHold: { keycode: "KI_CBTP1", delay: 0, actionType: 1 },
      doubleTap: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tapHold: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tappingTerms: 250,
    },
    {
      id: 1,
      name: "FP-BLE2",
      color: null,
      tap: { keycode: "KI_CBT2", delay: 0, actionType: 1 },
      onHold: { keycode: "KI_CBTP2", delay: 0, actionType: 1 },
      doubleTap: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tapHold: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tappingTerms: 250,
    },
    {
      id: 2,
      name: "FP-BLE3",
      color: null,
      tap: { keycode: "KI_CBT3", delay: 0, actionType: 1 },
      onHold: { keycode: "KI_CBTP3", delay: 0, actionType: 1 },
      doubleTap: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tapHold: { keycode: "KC_NONE", delay: 0, actionType: 1 },
      tappingTerms: 250,
    },
  ],
  Dd = { layers: Cd, fpLayer: Sd, actions: kd, multiactions: Ed };
class Nd {
  constructor() {
    v(this, "printLongString", (e, t, r = 1e4) => {
      p.error(`|device_keymap_service| --- START ${e} (${t.length} chars) ---`);
      for (let i = 0; i < t.length; i += r) p.error(t.slice(i, i + r));
      p.error(`--- END ${e} ---`);
    });
  }
  async parseKeymapFile(e, t) {
    p.info("|device_keymap_service| parsing keymap file");
    const r = t.toString("utf-8");
    if ((p.debug(r), !r)) {
      p.info("|device_keymap_service| keymap file does not exists");
      return;
    }
    let i = this.convertDeviceJson(r, e);
    if (!i) return;
    this.normalizeDeviceConfig(i);
    const n = this.migrateConfigIfNeeded(e, i);
    if (n) {
      if (
        (p.info("|device_keymap_service| sending migrated config"),
        !(await this.sendConfigData(e, n.copy(), () => {})))
      ) {
        p.error("|device_keymap_service| failed to write migrated config");
        return;
      }
      i = n;
    }
    return { deviceConfig: i, migrated: n !== void 0 };
  }
  migrateConfigIfNeeded(e, t) {
    if (e.info.deviceType !== U.KnobF1) return;
    const r = this.convertDeviceObject(structuredClone(md), e);
    if (
      !r ||
      (this.normalizeDeviceConfig(r),
      !Cs(this.getComparableKeymapConfig(t), this.getComparableKeymapConfig(r)))
    )
      return;
    p.info(
      "|device_keymap_service| virgin config matched, applying Framer F1 migration",
    );
    const i = process.platform === "darwin" ? wd : Dd,
      n = this.convertDefaultProfile(i, e);
    if (n) return (this.normalizeDeviceConfig(n), n);
  }
  convertDefaultProfile(e, t) {
    var c;
    if (!((c = e.layers.at(0)) != null && c.layout)) return;
    const r = e.actions.map(Je.rehydrate),
      i = e.multiactions.map(ze.rehydrate),
      n = (h) => h.map((d) => d.map((f) => f.keycode)),
      s = (h) =>
        vt.fromDTO({
          ...h,
          layout: {
            keymap: n(h.layout.base),
            encoders: n(h.layout.encoders),
            buttons: h.layout.buttons ? n(h.layout.buttons) : void 0,
            joystick: h.layout.joystick,
          },
        }),
      l = [...(e.fpLayer ? [e.fpLayer] : []), ...e.layers].map((h) =>
        s(mt.rehydrate(h)),
      );
    return new Ge({
      deviceInfo: t.info,
      files: [],
      activeProfileId: 0,
      profiles: [new tt(0, "Default", l)],
      actions: r,
      actionGroups: [],
      multiactions: i,
      multiactionGroups: [],
    });
  }
  normalizeDeviceConfig(e) {
    (this.assignMissingProfileAndLayerIds(e.profiles),
      this.pruneUnreferencedLinkedApps(e));
  }
  getComparableKeymapConfig(e) {
    var t, r, i, n, s;
    return {
      profiles: e.profiles.map((l) => l.toDTO()),
      actions:
        ((t = e.actions) == null ? void 0 : t.map((l) => l.toDTO())) ?? [],
      actionGroups:
        ((r = e.actionGroups) == null ? void 0 : r.map((l) => l.toDTO())) ?? [],
      multiactions:
        ((i = e.multiactions) == null ? void 0 : i.map((l) => l.toDTO())) ?? [],
      multiactionGroups:
        ((n = e.multiactionGroups) == null
          ? void 0
          : n.map((l) => l.toDTO())) ?? [],
      deviceSpecificConfig: e.deviceSpecificConfig,
      linkedApps:
        ((s = e.linkedApps) == null ? void 0 : s.map((l) => l.toDTO())) ?? [],
    };
  }
  parseSmartActionsFile(e, t) {
    var i;
    p.info("|device_keymap_service| parsing smart actions file");
    const r = t.toString("utf-8");
    if ((p.debug(r), r === void 0)) {
      p.error("|device_keymap_service| smart_actions.json file is undefined");
      return;
    }
    if (r === "File does not exist")
      return (
        p.info("|device_keymap_service| smart_actions.json does not exist"),
        { smartActions: [], smartActionGroups: [] }
      );
    try {
      const n = this.decodeUnicode(r),
        s = JSON.parse(n),
        l = s.smartActions ?? {},
        c = Object.entries(l);
      for (const [f] of c)
        if (!/^SA_(0|[1-9]\d*)$/.test(f)) {
          p.error(`|device_keymap_service| malformed smart action key: "${f}"`);
          return;
        }
      const h = c
          .sort(
            ([f], [_]) =>
              this.getSmartActionIdFromDeviceKey(f) -
              this.getSmartActionIdFromDeviceKey(_),
          )
          .map(([f, _]) =>
            this.fromDeviceJson(_, this.getSmartActionIdFromDeviceKey(f)),
          ),
        d =
          ((i = s.smartActionGroups) == null
            ? void 0
            : i.map((f) => Te.fromDeviceJson(f))) ?? [];
      return { smartActions: h, smartActionGroups: d };
    } catch (n) {
      (p.error(n),
        this.printLongString(
          "|device_keymap_service| smart actions json parse error:",
          r,
        ));
      return;
    }
  }
  async sendConfigData(e, t, r) {
    var i;
    try {
      let n = !1;
      if (t.smartActions) {
        const s = m.get().storageService.getDeviceConfig(e.info.devicePid);
        if (!s) n = !0;
        else {
          const l = t.smartActions.map((h) => h.toDTO()),
            c =
              ((i = t.smartActionGroups) == null
                ? void 0
                : i.map((h) => h.toDTO())) ?? [];
          n =
            JSON.stringify(l) !== JSON.stringify(s.smartActions) ||
            JSON.stringify(c) !== JSON.stringify(s.smartActionGroups ?? []);
        }
      }
      return n &&
        !(await this.sendSmartActionData(
          e,
          t.smartActions,
          t.smartActionGroups,
        ))
        ? !1
        : this.sendKeymapData(e, t, r);
    } catch (n) {
      return (
        p.error(
          "|device_keymap_service| error during send config data, error: " + n,
        ),
        !1
      );
    }
  }
  async sendSmartActionData(e, t, r) {
    try {
      const i = {};
      for (const l of t) i[`SA_${l.id}`] = this.toDeviceJson(l);
      const n = (r == null ? void 0 : r.map((l) => l.toDTO())) ?? [];
      let s = JSON.stringify({
        version: 1,
        smartActions: i,
        smartActionGroups: n,
      });
      return (
        (s = this.escapeUnicode(s)),
        p.info("|device_keymap_service| sending smart actions config :"),
        p.info(s),
        await e.rpcService.writeFileChunkedFromStr(ir, s, () => {})
      );
    } catch (i) {
      return (
        p.error(
          "|device_keymap_service| error during send smart action data, error: " +
            i,
        ),
        !1
      );
    }
  }
  toDeviceJson(e) {
    return {
      name: e.name,
      icon: e.icon,
      color: e.color ?? void 0,
      type: e.type,
      payload: e.payload,
    };
  }
  fromDeviceJson(e, t) {
    const r = (e == null ? void 0 : e.type) ?? xe.textStep,
      i = (e == null ? void 0 : e.payload) ?? { text: "" };
    return new Re(
      t,
      (e == null ? void 0 : e.name) ?? "",
      r,
      i,
      (e == null ? void 0 : e.color) ?? void 0,
      e == null ? void 0 : e.icon,
    );
  }
  getSmartActionIdFromDeviceKey(e) {
    return Number.parseInt(e.slice(3), 10);
  }
  async sendKeymapData(e, t, r) {
    var i, n, s, l, c;
    try {
      const h = t.profiles.map((b) =>
          b.toDeviceJson(t.actions, t.multiactions),
        ),
        d = (i = t.actions) == null ? void 0 : i.map((b) => b.toDeviceJson()),
        f = (n = t.actionGroups) == null ? void 0 : n.map((b) => b.toDTO()),
        _ =
          (s = t.multiactions) == null
            ? void 0
            : s.map((b) => b.toDeviceJson()),
        C =
          (l = t.multiactionGroups) == null ? void 0 : l.map((b) => b.toDTO()),
        O =
          (c = t.linkedApps) == null
            ? void 0
            : c.map((b) => it.rehydrate(b).toDTO()),
        T = {
          version: 1,
          activeProfileId: t.activeProfileId,
          language: t.language,
          profiles: h,
          multiActions: _,
          macros: d,
          macrosGroups: f,
          multiActionsGroups: C,
          deviceSpecificConfig: t.deviceSpecificConfig,
          linkedApps: O,
        };
      let W = JSON.stringify(T);
      return (
        (W = this.escapeUnicode(W)),
        p.info("|device_keymap_service| sending device config :"),
        p.info(W),
        await e.rpcService.writeFileChunkedFromStr(ut, W, r)
      );
    } catch (h) {
      return (
        p.error(
          "|device_keymap_service| error during send keymap data, error: " + h,
        ),
        !1
      );
    }
  }
  convertDeviceJson(e, t) {
    try {
      const r = this.decodeUnicode(e),
        i = JSON.parse(r);
      return this.convertDeviceObject(i, t);
    } catch (r) {
      (p.error(r),
        this.printLongString("|device_keymap_service| json parse error:", e));
      return;
    }
  }
  convertDeviceObject(e, t) {
    var r, i, n, s, l, c;
    try {
      let h =
        (r = e.profiles) == null ? void 0 : r.map((W) => tt.fromDeviceJson(W));
      h = h.map(
        (W) => (
          W.layers.map((b) => {
            var H, G, oe, ne, ge;
            return (
              (b.layout.keymap = b.layout.keymap.map((de) =>
                de.map((Ce) => this.remapKeyCodeForInput(Ce)),
              )),
              (b.layout.encoders =
                (H = b.layout.encoders) == null
                  ? void 0
                  : H.map((de) =>
                      de.map((Ce) => this.remapKeyCodeForInput(Ce)),
                    )),
              (b.layout.buttons =
                (G = b.layout.buttons) == null
                  ? void 0
                  : G.map((de) =>
                      de.map((Ce) => this.remapKeyCodeForInput(Ce)),
                    )),
              (oe = b.layout.joystick) != null &&
                oe.sectors &&
                (b.layout.joystick.sectors =
                  (ge =
                    (ne = b.layout.joystick) == null ? void 0 : ne.sectors) ==
                  null
                    ? void 0
                    : ge.map(
                        (de) => ((de.k = this.remapKeyCodeForInput(de.k)), de),
                      )),
              b
            );
          }),
          W
        ),
      );
      const d =
          (i = e.macros) == null ? void 0 : i.map((W) => Je.fromDeviceJson(W)),
        f =
          (n = e.multiActions) == null
            ? void 0
            : n.map((W) => ze.fromDeviceJson(W)),
        _ =
          (s = e.macrosGroups) == null
            ? void 0
            : s.map((W) => Te.fromDeviceJson(W)),
        C =
          (l = e.multiActionsGroups ?? e.multiActionGroups) == null
            ? void 0
            : l.map((W) => Te.fromDeviceJson(W)),
        O = e.deviceSpecificConfig,
        T = (c = e.linkedApps) == null ? void 0 : c.map((W) => it.fromDTO(W));
      return new Ge({
        deviceInfo: t.info,
        files: [],
        language: e.language,
        activeProfileId: e.activeProfileId,
        profiles: h,
        actions: d,
        multiactions: f,
        actionGroups: _,
        multiactionGroups: C,
        deviceSpecificConfig: O,
        linkedApps: T,
      });
    } catch (h) {
      p.error(h);
      return;
    }
  }
  remapKeyCodeForInput(e) {
    return e.startsWith("KA_A")
      ? e.replace("KA_A", "KA_")
      : e.startsWith("KA_M")
        ? e.replace("KA_M", "KM_")
        : e.startsWith("KC_FUNC")
          ? e.replace("KC_FUNC", "KI_FP")
          : e;
  }
  assignMissingProfileAndLayerIds(e) {
    this.assignMissingIds(e);
    for (const t of e) this.assignMissingIds(t.layers);
  }
  assignMissingIds(e) {
    const t = [];
    for (const i of e) {
      const n = i.id;
      n != null && t.push(n);
    }
    t.sort((i, n) => i - n);
    let r = t.length > 0 ? t[t.length - 1] + 1 : 0;
    for (const i of e) (i.id !== void 0 && i.id !== null) || ((i.id = r), r++);
  }
  pruneUnreferencedLinkedApps(e) {
    const t = e.linkedApps;
    if (t == null) return;
    const r = new Set();
    for (const i of e.profiles)
      for (const n of i.layers) {
        const s = n.linkedAppId;
        s != null && r.add(s);
      }
    e.linkedApps = t.filter((i) => r.has(i.id));
  }
  remapKeyCodeForDevice(e) {
    return e.startsWith("KA_")
      ? e.replace("KA_", "KA_A")
      : e.startsWith("KM_")
        ? e.replace("KM_", "KA_M")
        : e;
  }
  escapeUnicode(e) {
    return e.replace(/[^\x00-\x7F]/gu, (t) => {
      const r = t.codePointAt(0);
      if (r !== void 0 && r > 65535) {
        const i = ((r - 65536) >> 10) | 55296,
          n = ((r - 65536) & 1023) | 56320;
        return `\\u${i.toString(16).padStart(4, "0")}\\u${n.toString(16).padStart(4, "0")}`;
      }
      return `\\u${r == null ? void 0 : r.toString(16).padStart(4, "0")}`;
    });
  }
  decodeUnicode(e) {
    return e.replace(
      /\\u([a-fA-F0-9]{4})(?:\\u([a-fA-F0-9]{4}))?/g,
      (t, r, i) => {
        if (i) {
          const n = parseInt(r, 16),
            s = parseInt(i, 16),
            l = ((n - 55296) << 10) + (s - 56320) + 65536;
          if (l < 0) {
            let c = String.fromCharCode(n);
            return ((c += String.fromCharCode(s)), c);
          }
          return String.fromCodePoint(l);
        }
        return String.fromCharCode(parseInt(r, 16));
      },
    );
  }
}
class Id {
  constructor() {
    v(this, "userConsented", !1);
    v(this, "apiKey");
    v(this, "measurementId");
    v(this, "userId");
    ((this.apiKey = "Qp5uX6U8QvqQDEszCjnkGw"),
      (this.measurementId = "G-3YVLLXG6L2"),
      (this.userId = m.get().diagnosticService.getUserId()));
  }
  checkUserConsented() {
    p.debug("|analytics_service| check analytics consent");
    const e = m.get().storageService.getAppSettings();
    this.userConsented = (e == null ? void 0 : e.analyticsConsented) ?? !1;
  }
  async sendAnalyticsEvent(e) {
    if (!this.userConsented) {
      p.debug("|analytics_service| user did not consent to data collection");
      return;
    }
    p.debug("|analytics_service| sending analytics event");
    try {
      const t = {
          name: e.event_type,
          params: {
            engagement_time_msec: 1,
            app_version: z.getVersion(),
            platform: process.platform,
            debug_mode: process.env.VITE_DEV_SERVER_URL !== void 0,
            ...e.params,
          },
        },
        r = JSON.stringify({ client_id: this.userId, events: [t] });
      await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${this.measurementId}&api_secret=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: r,
        },
      );
    } catch (t) {
      p.error(
        `|analytics_service| error while sending analytics data error: ${t}`,
      );
    }
  }
}
class Td {
  constructor() {
    v(this, "id");
    v(this, "filePath", $i.join(z.getPath("userData"), "user-id.json"));
    this.id = this.getUserId();
  }
  getDeviceName(e) {
    switch (e) {
      case U.NomadE:
        return "Nomad E";
      case U.NomadEV2:
        return "Nomad E V2";
      case U.Knob:
        return "Knob1";
      case U.KnobF1:
        return "KnobF1";
      case U.CreatorMicroV2:
        return "Creator Micro V2";
      case U.XYZ:
        return "XYZ r2";
      case U.CodexMicro:
        return "Codex Micro";
      case U.Bootloader:
        return "Bootloader";
    }
  }
  getUserId() {
    try {
      if (te.existsSync(this.filePath)) {
        const { id: e } = JSON.parse(te.readFileSync(this.filePath, "utf-8"));
        return e;
      }
      return this.createUserId();
    } catch {
      return this.createUserId();
    }
  }
  createUserId() {
    const e = ws();
    return (te.writeFileSync(this.filePath, JSON.stringify({ id: e })), e);
  }
  onDiagnosticNotify(e, t) {
    p.log("|diagnostic_service| received diagnostic data");
    const r = m.get().devicesCommManager.getDevice(e);
    if (!r) {
      p.error("|diagnostic_service| cannot find device from notify");
      return;
    }
    try {
      const i = t.category,
        n = t.payload;
      fetch(
        "https://docs.google.com/forms/u/0/d/e/1FAIpQLScqgTELp8dmiWCzWgjOrkQ1aPiIFfJUdSZy2oRUYUoxtqGP6w/formResponse",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            "entry.1567907827": this.id,
            "entry.51741189": this.getDeviceName(r.info.deviceType),
            "entry.1537036643": i,
            "entry.203112451": JSON.stringify(n),
          }),
        },
      );
    } catch (i) {
      p.error(`|diagnostic_service| error on notify error: ${i}`);
      return;
    }
  }
}
var ye = ((o) => (
  (o.getFirmwareVersion = "rpcGetFirmwareVersion"),
  (o.getDeviceStatus = "rpcGetDeviceStatus"),
  (o.getFirmwareVersionLegacy = "rpcGetFirmwareVersionLegacy"),
  (o.sentIntoBootloader = "rpcSentIntoBootloader"),
  (o.sentIntoBootloaderLegacy = "rpcSentIntoBootloaderLegacy"),
  (o.sendIntoSelfTest = "rpcSendIntoSelfTest"),
  (o.sendIntoSelfTestLegacy = "rpcSendIntoSelfTestLegacy"),
  (o.getFileList = "rpcGetFileList"),
  (o.readFile = "rpcReadFile"),
  (o.writeFile = "rpcWriteFile"),
  (o.writeFileChunked = "rpcWriteFileChunked"),
  (o.readFileChunked = "rpcreadFileChunked"),
  (o.deleteFile = "rpcDeleteFile"),
  (o.sendHomeAccentColor = "rpcSentHomeAccentColor"),
  (o.sendLightingPreview = "rpcSendLightingPreview"),
  (o.fetchDeviceData = "rpcFetchDeviceData"),
  (o.fetchWallpaper = "rpcFetchWallpaper"),
  o
))(ye || {});
class bd {
  constructor() {
    this.createHandlers();
  }
  createHandlers() {
    (N.handle(ye.getFirmwareVersion, (e, t) => this.getFirmwareVersion(t)),
      N.handle(ye.getDeviceStatus, (e, t) => this.getDeviceStatus(t)),
      N.handle(ye.getFirmwareVersionLegacy, (e, t) =>
        this.getFirmwareVersionLegacy(t),
      ),
      N.handle(ye.sentIntoBootloader, (e, t) => this.sendIntoBootloader(t)),
      N.handle(ye.sentIntoBootloaderLegacy, (e, t) =>
        this.sentIntoBootloaderLegacy(t),
      ),
      N.handle(ye.sendIntoSelfTest, (e, t) => this.sendIntoSelfTest(t)),
      N.handle(ye.sendIntoSelfTestLegacy, (e, t) =>
        this.sendIntoSelfTestLegacy(t),
      ),
      N.handle(ye.getFileList, (e, t) => this.getFileList(t)),
      N.handle(ye.readFile, (e, t, r) => this.readFile(t, r)),
      N.handle(ye.writeFile, (e, t, r, i) => this.writeFile(t, r, i)),
      N.handle(ye.writeFileChunked, (e, t, r, i) =>
        this.writeFileChunked(t, r, i),
      ),
      N.handle(ye.readFileChunked, (e, t, r) => this.readFileChunked(t, r)),
      N.handle(ye.deleteFile, (e, t, r) => this.deleteFile(t, r)),
      N.handle(ye.sendHomeAccentColor, (e, t, r) =>
        this.sendHomeAccentColor(t, r),
      ),
      N.handle(ye.sendLightingPreview, (e, t, r) =>
        this.sendLightingPreview(t, r),
      ),
      N.handle(ye.fetchDeviceData, (e, t) => this.fetchDeviceData(t)),
      N.handle(ye.fetchWallpaper, (e, t) => this.fetchWallpaper(t)));
  }
  getFirmwareVersion(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.rpcService.getFirmwareVersion() : Promise.reject(new Q());
  }
  getDeviceStatus(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.rpcService.getDeviceStatus() : Promise.reject(new Q());
  }
  getFirmwareVersionLegacy(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t
      ? t.rpcService.getFirmwareVersionLegacy()
      : Promise.reject(new Q());
  }
  sendIntoBootloader(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.rpcService.sendIntoBootloader() : Promise.reject(new Q());
  }
  sentIntoBootloaderLegacy(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t
      ? t.rpcService.sendIntoBootloaderLegacy()
      : Promise.reject(new Q());
  }
  sendIntoSelfTest(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.rpcService.sendIntoSelfTest() : Promise.reject(new Q());
  }
  sendIntoSelfTestLegacy(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.rpcService.sendIntoSelfTestLegacy() : Promise.reject(new Q());
  }
  getFileList(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t ? t.rpcService.getFileList() : Promise.reject(new Q());
  }
  readFile(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r ? r.rpcService.readFile(t) : Promise.reject(new Q());
  }
  writeFile(e, t, r) {
    const i = m.get().devicesCommManager.getDevice(e);
    return i ? i.rpcService.writeFile(t, r) : Promise.reject(new Q());
  }
  writeFileChunked(e, t, r) {
    const i = m.get().devicesCommManager.getDevice(e);
    return i ? i.rpcService.writeFileChunked(t, r) : Promise.reject(new Q());
  }
  readFileChunked(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r ? r.rpcService.readFileChunked(t) : Promise.reject(new Q());
  }
  deleteFile(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r ? r.rpcService.deleteFile(t) : Promise.reject(new Q());
  }
  sendHomeAccentColor(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r ? r.rpcService.sendHomeAccentColor(t) : Promise.reject(new Q());
  }
  sendLightingPreview(e, t) {
    const r = m.get().devicesCommManager.getDevice(e);
    return r ? r.rpcService.sendLightingPreview(t) : Promise.reject(new Q());
  }
  fetchDeviceData(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t
      ? m.get().deviceFileService.fetchDeviceFiles(t)
      : Promise.reject(new Q());
  }
  async fetchWallpaper(e) {
    const t = m.get().devicesCommManager.getDevice(e);
    return t
      ? m.get().deviceFileService.fetchWallpaper(t)
      : Promise.reject(new Q());
  }
}
class Od {
  constructor(e, t) {
    v(this, "filename");
    v(this, "data");
    ((this.filename = e), (this.data = t));
  }
}
class Kd {
  async deleteFile(e) {
    try {
      return (await te.promises.unlink(e), !0);
    } catch (t) {
      return (p.error("|fs_service| error while deleting file", t), !1);
    }
  }
  async saveBackupFile(e, t) {
    const r = fe(z.getPath("temp"), "backup"),
      i = this.getSafeChildPath(r, e);
    try {
      return (
        await te.promises.mkdir(xi(i), { recursive: !0 }),
        await te.promises.writeFile(i, t),
        !0
      );
    } catch (n) {
      return (
        p.error("|fs_service| error while saving backup file, error: " + n),
        !1
      );
    }
  }
  async getBackupFiles() {
    const e = fe(z.getPath("temp"), "backup");
    try {
      try {
        await te.promises.access(e);
      } catch {
        return [];
      }
      const t = await this.getFilesRecursive(e);
      return Promise.all(
        t.map(async (r) => {
          const i = fs(e, r).split(kr).join("/"),
            n = await te.promises.readFile(r);
          return new Od(i, n);
        }),
      );
    } catch (t) {
      return (
        p.error("|fs_service| error while getting backup files, error: " + t),
        []
      );
    }
  }
  async deleteBackupFiles() {
    const e = fe(z.getPath("temp"), "backup");
    try {
      try {
        await te.promises.access(e);
      } catch {
        return !0;
      }
      return (
        p.info("|fs_service| deleting backup files"),
        await te.promises.rm(e, { recursive: !0, force: !0 }),
        !0
      );
    } catch (t) {
      return (
        p.error("|fs_service| error while deleting backup files, error: " + t),
        !1
      );
    }
  }
  async getDeviceFile(e, t) {
    try {
      const r = this.getDeviceFilePath(e, t);
      try {
        await te.promises.access(r);
      } catch {
        return;
      }
      return await te.promises.readFile(r);
    } catch (r) {
      p.error("|fs_service| error while getting device file, error: " + r);
      return;
    }
  }
  async saveDeviceFile(e, t, r) {
    try {
      const i = this.getDeviceFilePath(e, t);
      return (
        await te.promises.mkdir(xi(i), { recursive: !0 }),
        await te.promises.writeFile(i, r),
        !0
      );
    } catch (i) {
      return (
        p.error("|fs_service| error while saving device file, error: " + i),
        !1
      );
    }
  }
  async deleteDeviceFile(e, t) {
    try {
      const r = this.getDeviceFilePath(e, t);
      try {
        await te.promises.access(r);
      } catch {
        return !0;
      }
      return (await te.promises.unlink(r), !0);
    } catch (r) {
      return (
        p.error("|fs_service| error while deleting device file, error: " + r),
        !1
      );
    }
  }
  async getWallpaperImageRaw(e, t) {
    return this.getDeviceFile(e, t);
  }
  async getWallpaperImage(e, t) {
    const r = sd(t),
      i = await this.getWallpaperImageRaw(e, t);
    if (!(!r || !i)) {
      if (r === Tt.gif) return { data: i, format: r, mimeType: Mo(r) };
      try {
        return {
          data: await m.get().imageService.convertFromLvglFormat(i),
          format: r,
          mimeType: Mo(r),
        };
      } catch (n) {
        p.error(`|fs_service| failed to convert wallpaper to PNG: ${n}`);
        return;
      }
    }
  }
  async readBinaryFile(e) {
    try {
      return (
        p.info("|FsChannel| Reading file with path: " + e),
        (await te.promises.readFile(e)).toString("binary")
      );
    } catch (t) {
      throw (
        p.error("|fs_service| error while reading binary file, error: " + t),
        t
      );
    }
  }
  getDeviceFilePath(e, t) {
    const r = fe(z.getPath("userData"), "devices"),
      i = this.getSafeChildPath(r, e);
    return this.getSafeChildPath(i, t);
  }
  getSafeChildPath(e, t) {
    const r = t.replace(/^[\\/]+/, "").replace(/[\\/]+/g, kr);
    if (!r) throw new Error("Managed file path cannot be empty");
    const i = Wi(e),
      n = Wi(i, r);
    if (!n.startsWith(`${i}${kr}`))
      throw new Error(`Managed file path escapes its base directory: ${t}`);
    return n;
  }
  async getFilesRecursive(e) {
    const t = await te.promises.readdir(e, { withFileTypes: !0 });
    return (
      await Promise.all(
        t.map(async (r) => {
          const i = fe(e, r.name);
          return r.isDirectory() ? this.getFilesRecursive(i) : [i];
        }),
      )
    ).flat();
  }
}
class Fd {
  handleDeviceNotify() {
    m.get().devicesCommManager.onNotifyEvent((e) => {
      if (
        (p.info(`|device_notify_service| received notify event ${e.method}`),
        e.method.startsWith("kb."))
      ) {
        this.handleKeyboardEvents(e);
        return;
      }
      switch (e.method) {
        case L.mediaPlayerFetchData:
          m.get().mediaPlayerService.onNotifyReceived(e.deviceId, e.params);
          break;
        case L.genericAlert:
          m.get().notificationService.onNotifyReceived(e.deviceId, e.params);
          break;
        case L.diagnostic:
          m.get().diagnosticService.onDiagnosticNotify(e.deviceId, e.params);
          break;
        default:
          p.warn(
            `|device_notify_service| could not handle notify with method: ${e.method}`,
          );
          break;
      }
    });
  }
  handleKeyboardEvents(e) {
    switch (e.method) {
      case L.radialMenu:
        m.get().windowService.onRadialMenuNotify(e.deviceId, e.params);
        break;
      case L.insertText:
        const t = e.params.text;
        if (!t || typeof t != "string") {
          p.error(
            "|device_notify_service| text insert received without text param",
          );
          return;
        }
        m.get()
          .nativeService.insertText(t)
          .catch((s) => {
            p.error(`|device_notify_service| failed to insert text: ${s}`);
          });
        break;
      case L.execCmd:
        if (
          !m.get().applicationService.getAppSettings().smartActionCmdEnabled
        ) {
          p.info(
            "|device_notify_service| user has not given consent to run cmd from device",
          );
          return;
        }
        const r = e.params.cmd;
        if (!r || typeof r != "string") {
          p.error("|device_notify_service| run cmd received without cmd param");
          return;
        }
        Er(r, (s, l, c) => {
          (s && p.info(`|device_notify_service| run cmd output, error: ${s}`),
            l && p.info(`|device_notify_service| run cmd output, stdout: ${l}`),
            c &&
              p.info(`|device_notify_service| run cmd output, stderr: ${c}`));
        });
        break;
      case L.openApplication:
        const i = e.params.path;
        if (!i || typeof i != "string") {
          p.error(
            "|device_notify_service| open app notify received without path",
          );
          return;
        }
        m.get().nativeService.openExternalApp(i);
        break;
      case L.operUrl:
        const n = e.params.url;
        if (!n || typeof n != "string") {
          p.error(
            "|device_notify_service| open url notify received without url",
          );
          return;
        }
        m.get().applicationService.openExternalTab(n);
        break;
      case L.showCheatSheet:
        m.get().windowService.onCheatSheetNotify(e.deviceId, 1, e.params);
        break;
      case L.hideCheatSheet:
        m.get().windowService.onCheatSheetNotify(e.deviceId, 0, e.params);
        break;
      case L.toggleCheatSheet:
        m.get().windowService.onCheatSheetNotify(e.deviceId, 2, e.params);
        break;
      default:
        p.warn(
          `|device_notify_service| could not handle keyboard notify with method: ${e.method}`,
        );
        break;
    }
  }
}
class Ad {
  constructor() {
    this.createListeners();
  }
  createListeners() {
    (N.handle(Dt.reportWindowSize, (e, t, r) => this.reportWindowSize(t, r)),
      N.on(Dt.startDrag, () => this.startDrag()),
      N.on(Dt.stopDrag, () => this.stopDrag()));
  }
  reportWindowSize(e, t) {
    if (!Number.isFinite(e) || !Number.isFinite(t)) return;
    const r = (i) => Math.max(1, Math.min(8e3, Math.round(i)));
    m.get().windowService.onCheatSheetWindowCreated(r(e), r(t));
  }
  startDrag() {
    m.get().windowService.startCheatSheetDrag();
  }
  stopDrag() {
    m.get().windowService.stopCheatSheetDrag();
  }
}
class Md {
  constructor() {
    v(this, "tag", "|device_flash_service");
    v(this, "releaseService");
    v(this, "fwProgrammer");
    const e = { info: p.info, error: p.error, debug: p.debug, warn: p.warn };
    ((this.releaseService = new Ri(e)),
      (this.fwProgrammer = new cs({
        logger: e,
        onProgress(t, r, i) {
          m.get().windowService.sendDataToMainWin(Ae.onFlashingProgress, r, i);
        },
        onWriteLine(t) {
          m.get().windowService.sendDataToMainWin(
            Ae.onFlashingLog,
            t +
              `
`,
          );
        },
      })));
  }
  async checkForFwUpdates(e, t) {
    const r = await m.get().applicationService.appVersion();
    if (!r) {
      p.error(this.tag, " cannot get app version");
      return;
    }
    if (!e) {
      p.error(this.tag, " device has no fw version");
      return;
    }
    const i = await this.releaseService.shouldUpdateFirmware(r, e, t);
    return (i && p.info(this.tag, " device has fw update available"), i);
  }
  async getLatestFwRelease(e, t) {
    return this.releaseService.getLatestRelease(Ri.getFirmwareRepo(e), t);
  }
  async flashFirmware(e, t) {
    return this.fwProgrammer.flashDeviceFirmware(e, t);
  }
}
const et = class et {
  constructor() {
    v(this, "_updateService");
    v(this, "_fsService");
    v(this, "_storageService");
    v(this, "_searchDevicesService");
    v(this, "_applicationService");
    v(this, "_windowService");
    v(this, "_trayService");
    v(this, "_deviceFlashService");
    v(this, "_devicesCommManager");
    v(this, "_deviceNotifyService");
    v(this, "_deviceFileService");
    v(this, "_imageService");
    v(this, "_nativeService");
    v(this, "_mediaPlayerService");
    v(this, "_focusAppService");
    v(this, "_notificationService");
    v(this, "_deviceScreenService");
    v(this, "_deviceKeymapService");
    v(this, "_diagnosticService");
    v(this, "_analyticsService");
    v(this, "_commonChannel");
    v(this, "_imageChannel");
    v(this, "_localStorageChannel");
    v(this, "_devicesManagerChannel");
    v(this, "_connectedDeviceChannel");
    v(this, "_rpcChannel");
    v(this, "_fsChannel");
    v(this, "_cheatSheetChannel");
  }
  static get() {
    return (et.instance || (et.instance = new et()), et.instance);
  }
  initializeMainServices() {
    ((this._updateService = new Pl()),
      (this._fsService = new Kd()),
      (this._storageService = new Vl()),
      (this._searchDevicesService = new ar()),
      (this._applicationService = new Ws()),
      (this._windowService = new xs()),
      (this._trayService = new Ll()),
      (this._deviceFlashService = new Md()),
      (this._devicesCommManager = new id()),
      (this._deviceNotifyService = new Fd()),
      (this._deviceFileService = new ld()),
      (this._nativeService = new zl()),
      (this._mediaPlayerService = new ks()),
      (this._focusAppService = new Xl()),
      (this._notificationService = new Ul()),
      (this._deviceScreenService = new od()),
      (this._deviceKeymapService = new Nd()),
      (this._diagnosticService = new Td()),
      (this._analyticsService = new Id()),
      (this._imageService = new Rl()));
  }
  initializeChannels() {
    ((this._commonChannel = new Ps()),
      (this._imageChannel = new Rs()),
      (this._localStorageChannel = new Bl()),
      (this._connectedDeviceChannel = new As()),
      (this._fsChannel = new Ls()),
      (this._devicesManagerChannel = new Ms()),
      (this._rpcChannel = new bd()));
  }
  lazyInitChannels() {}
  get updateService() {
    return this._updateService;
  }
  get fsService() {
    return this._fsService;
  }
  get storageService() {
    return this._storageService;
  }
  get searchDevicesService() {
    return this._searchDevicesService;
  }
  get applicationService() {
    return this._applicationService;
  }
  get windowService() {
    return this._windowService;
  }
  get trayService() {
    return this._trayService;
  }
  get deviceFlashService() {
    return this._deviceFlashService;
  }
  get devicesCommManager() {
    return this._devicesCommManager;
  }
  get deviceNotifyService() {
    return this._deviceNotifyService;
  }
  get deviceFileService() {
    return this._deviceFileService;
  }
  get connectedDeviceChannel() {
    return this._connectedDeviceChannel;
  }
  get imageService() {
    return this._imageService;
  }
  get nativeService() {
    return this._nativeService;
  }
  get mediaPlayerService() {
    return this._mediaPlayerService;
  }
  get focusAppService() {
    return this._focusAppService;
  }
  get notificationService() {
    return this._notificationService;
  }
  get deviceScreenService() {
    return this._deviceScreenService;
  }
  get deviceKeymapService() {
    return this._deviceKeymapService;
  }
  get diagnosticService() {
    return this._diagnosticService;
  }
  get analyticsService() {
    return this._analyticsService;
  }
  get commonChannel() {
    return this._commonChannel;
  }
  get imageChannel() {
    return this._imageChannel;
  }
  get rpcChannel() {
    return this._rpcChannel;
  }
  get fsChannel() {
    return this._fsChannel;
  }
  get devicesManagerChannel() {
    return this._devicesManagerChannel;
  }
  get localStorageChannel() {
    return this._localStorageChannel;
  }
  get cheatSheetChannel() {
    return this._cheatSheetChannel ?? (this._cheatSheetChannel = new Ad());
  }
};
v(et, "instance");
let m = et;
var je = { exports: {} };
const Pd = "17.2.3",
  Rd = { version: Pd },
  Hr = gs,
  or = $i,
  Ld = Ss,
  $d = Dr,
  xd = Rd,
  Jr = xd.version,
  Lo = [
    "\u{1F510} encrypt with Dotenvx: https://dotenvx.com",
    "\u{1F510} prevent committing .env to code: https://dotenvx.com/precommit",
    "\u{1F510} prevent building .env in docker: https://dotenvx.com/prebuild",
    "\u{1F4E1} add observability to secrets: https://dotenvx.com/ops",
    "\u{1F465} sync secrets across teammates & machines: https://dotenvx.com/ops",
    "\u{1F5C2}\uFE0F backup and recover secrets: https://dotenvx.com/ops",
    "\u2705 audit secrets and track compliance: https://dotenvx.com/ops",
    "\u{1F504} add secrets lifecycle management: https://dotenvx.com/ops",
    "\u{1F511} add access controls to secrets: https://dotenvx.com/ops",
    "\u{1F6E0}\uFE0F  run anywhere with `dotenvx run -- yourcommand`",
    "\u2699\uFE0F  specify custom .env file path with { path: '/custom/path/.env' }",
    "\u2699\uFE0F  enable debug logging with { debug: true }",
    "\u2699\uFE0F  override existing env vars with { override: true }",
    "\u2699\uFE0F  suppress all logs with { quiet: true }",
    "\u2699\uFE0F  write to custom object with { processEnv: myObject }",
    "\u2699\uFE0F  load multiple .env files with { path: ['.env.local', '.env'] }",
  ];
function Wd() {
  return Lo[Math.floor(Math.random() * Lo.length)];
}
function ft(o) {
  return typeof o == "string"
    ? !["false", "0", "no", "off", ""].includes(o.toLowerCase())
    : !!o;
}
function jd() {
  return process.stdout.isTTY;
}
function Ud(o) {
  return jd() ? `\x1B[2m${o}\x1B[0m` : o;
}
const Vd =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
function Bd(o) {
  const e = {};
  let t = o.toString();
  t = t.replace(
    /\r\n?/gm,
    `
`,
  );
  let r;
  for (; (r = Vd.exec(t)) != null; ) {
    const i = r[1];
    let n = r[2] || "";
    n = n.trim();
    const s = n[0];
    ((n = n.replace(/^(['"`])([\s\S]*)\1$/gm, "$2")),
      s === '"' &&
        ((n = n.replace(
          /\\n/g,
          `
`,
        )),
        (n = n.replace(/\\r/g, "\r"))),
      (e[i] = n));
  }
  return e;
}
function Gd(o) {
  o = o || {};
  const e = Wo(o);
  o.path = e;
  const t = ve.configDotenv(o);
  if (!t.parsed) {
    const s = new Error(
      `MISSING_DATA: Cannot parse ${e} for an unknown reason`,
    );
    throw ((s.code = "MISSING_DATA"), s);
  }
  const r = xo(o).split(","),
    i = r.length;
  let n;
  for (let s = 0; s < i; s++)
    try {
      const l = r[s].trim(),
        c = Jd(t, l);
      n = ve.decrypt(c.ciphertext, c.key);
      break;
    } catch (l) {
      if (s + 1 >= i) throw l;
    }
  return ve.parse(n);
}
function Hd(o) {
  console.error(`[dotenv@${Jr}][WARN] ${o}`);
}
function nr(o) {
  console.log(`[dotenv@${Jr}][DEBUG] ${o}`);
}
function $o(o) {
  console.log(`[dotenv@${Jr}] ${o}`);
}
function xo(o) {
  return o && o.DOTENV_KEY && o.DOTENV_KEY.length > 0
    ? o.DOTENV_KEY
    : process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0
      ? process.env.DOTENV_KEY
      : "";
}
function Jd(o, e) {
  let t;
  try {
    t = new URL(e);
  } catch (l) {
    if (l.code === "ERR_INVALID_URL") {
      const c = new Error(
        "INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development",
      );
      throw ((c.code = "INVALID_DOTENV_KEY"), c);
    }
    throw l;
  }
  const r = t.password;
  if (!r) {
    const l = new Error("INVALID_DOTENV_KEY: Missing key part");
    throw ((l.code = "INVALID_DOTENV_KEY"), l);
  }
  const i = t.searchParams.get("environment");
  if (!i) {
    const l = new Error("INVALID_DOTENV_KEY: Missing environment part");
    throw ((l.code = "INVALID_DOTENV_KEY"), l);
  }
  const n = `DOTENV_VAULT_${i.toUpperCase()}`,
    s = o.parsed[n];
  if (!s) {
    const l = new Error(
      `NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${n} in your .env.vault file.`,
    );
    throw ((l.code = "NOT_FOUND_DOTENV_ENVIRONMENT"), l);
  }
  return { ciphertext: s, key: r };
}
function Wo(o) {
  let e = null;
  if (o && o.path && o.path.length > 0)
    if (Array.isArray(o.path))
      for (const t of o.path)
        Hr.existsSync(t) && (e = t.endsWith(".vault") ? t : `${t}.vault`);
    else e = o.path.endsWith(".vault") ? o.path : `${o.path}.vault`;
  else e = or.resolve(process.cwd(), ".env.vault");
  return Hr.existsSync(e) ? e : null;
}
function jo(o) {
  return o[0] === "~" ? or.join(Ld.homedir(), o.slice(1)) : o;
}
function zd(o) {
  const e = ft(process.env.DOTENV_CONFIG_DEBUG || (o && o.debug)),
    t = ft(process.env.DOTENV_CONFIG_QUIET || (o && o.quiet));
  (e || !t) && $o("Loading env from encrypted .env.vault");
  const r = ve._parseVault(o);
  let i = process.env;
  return (
    o && o.processEnv != null && (i = o.processEnv),
    ve.populate(i, r, o),
    { parsed: r }
  );
}
function Xd(o) {
  const e = or.resolve(process.cwd(), ".env");
  let t = "utf8",
    r = process.env;
  o && o.processEnv != null && (r = o.processEnv);
  let i = ft(r.DOTENV_CONFIG_DEBUG || (o && o.debug)),
    n = ft(r.DOTENV_CONFIG_QUIET || (o && o.quiet));
  o && o.encoding
    ? (t = o.encoding)
    : i && nr("No encoding is specified. UTF-8 is used by default");
  let s = [e];
  if (o && o.path)
    if (!Array.isArray(o.path)) s = [jo(o.path)];
    else {
      s = [];
      for (const d of o.path) s.push(jo(d));
    }
  let l;
  const c = {};
  for (const d of s)
    try {
      const f = ve.parse(Hr.readFileSync(d, { encoding: t }));
      ve.populate(c, f, o);
    } catch (f) {
      (i && nr(`Failed to load ${d} ${f.message}`), (l = f));
    }
  const h = ve.populate(r, c, o);
  if (
    ((i = ft(r.DOTENV_CONFIG_DEBUG || i)),
    (n = ft(r.DOTENV_CONFIG_QUIET || n)),
    i || !n)
  ) {
    const d = Object.keys(h).length,
      f = [];
    for (const _ of s)
      try {
        const C = or.relative(process.cwd(), _);
        f.push(C);
      } catch (C) {
        (i && nr(`Failed to load ${_} ${C.message}`), (l = C));
      }
    $o(`injecting env (${d}) from ${f.join(",")} ${Ud(`-- tip: ${Wd()}`)}`);
  }
  return l ? { parsed: c, error: l } : { parsed: c };
}
function Yd(o) {
  if (xo(o).length === 0) return ve.configDotenv(o);
  const e = Wo(o);
  return e
    ? ve._configVault(o)
    : (Hd(
        `You set DOTENV_KEY but you are missing a .env.vault file at ${e}. Did you forget to build it?`,
      ),
      ve.configDotenv(o));
}
function qd(o, e) {
  const t = Buffer.from(e.slice(-64), "hex");
  let r = Buffer.from(o, "base64");
  const i = r.subarray(0, 12),
    n = r.subarray(-16);
  r = r.subarray(12, -16);
  try {
    const s = $d.createDecipheriv("aes-256-gcm", t, i);
    return (s.setAuthTag(n), `${s.update(r)}${s.final()}`);
  } catch (s) {
    const l = s instanceof RangeError,
      c = s.message === "Invalid key length",
      h = s.message === "Unsupported state or unable to authenticate data";
    if (l || c) {
      const d = new Error(
        "INVALID_DOTENV_KEY: It must be 64 characters long (or more)",
      );
      throw ((d.code = "INVALID_DOTENV_KEY"), d);
    } else if (h) {
      const d = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
      throw ((d.code = "DECRYPTION_FAILED"), d);
    } else throw s;
  }
}
function Zd(o, e, t = {}) {
  const r = !!(t && t.debug),
    i = !!(t && t.override),
    n = {};
  if (typeof e != "object") {
    const s = new Error(
      "OBJECT_REQUIRED: Please check the processEnv argument being passed to populate",
    );
    throw ((s.code = "OBJECT_REQUIRED"), s);
  }
  for (const s of Object.keys(e))
    Object.prototype.hasOwnProperty.call(o, s)
      ? (i === !0 && ((o[s] = e[s]), (n[s] = e[s])),
        r &&
          nr(
            i === !0
              ? `"${s}" is already defined and WAS overwritten`
              : `"${s}" is already defined and was NOT overwritten`,
          ))
      : ((o[s] = e[s]), (n[s] = e[s]));
  return n;
}
const ve = {
  configDotenv: Xd,
  _configVault: zd,
  _parseVault: Gd,
  config: Yd,
  decrypt: qd,
  parse: Bd,
  populate: Zd,
};
((je.exports.configDotenv = ve.configDotenv),
  (je.exports._configVault = ve._configVault),
  (je.exports._parseVault = ve._parseVault),
  (je.exports.config = ve.config),
  (je.exports.decrypt = ve.decrypt),
  (je.exports.parse = ve.parse),
  (je.exports.populate = ve.populate),
  (je.exports = ve));
var Qd = je.exports;
const ep = Vi(Qd);
(ep.config(),
  (globalThis.__filename = rs(import.meta.url)),
  (globalThis.__dirname = ts(__filename)),
  (process.env.DIST_ELECTRON = ue(__dirname, "../")),
  (process.env.DIST = ue(process.env.DIST_ELECTRON, "../dist")),
  (process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
    ? ue(process.env.DIST_ELECTRON, "../public")
    : process.env.DIST),
  (process.env.EDGE_USE_CORECLR = "0"));
let zr = "";
if (z.isPackaged) {
  const o = process.resourcesPath;
  zr = ue(o, "native", "windows", "bin");
} else zr = ue(__dirname, "..", "..", "resources", "native", "windows", "bin");
process.env.EDGE_APP_ROOT = zr;
const tp = process.env.VITE_DEV_SERVER_URL !== void 0;
function rp() {
  try {
    const o = z.getLoginItemSettings && z.getLoginItemSettings();
    if (o && o.wasOpenedAtLogin) return !0;
  } catch {
    return !1;
  }
  return !!process.argv.map((o) => o.toLowerCase()).includes("--autostart");
}
((process.env.VERSION = z.getVersion()),
  es().startsWith("6.1") && z.disableHardwareAcceleration(),
  process.platform === "win32" && z.setAppUserModelId(z.getName()),
  z.setLoginItemSettings({
    openAtLogin: !0,
    path: process.execPath,
    args: ["--autostart"],
  }),
  m.get().initializeMainServices(),
  m.get().initializeChannels(),
  p.initialize(),
  (p.transports.console.format = "{h}:{i}:{s} {text}"),
  tp ? (p.transports.ipc.level = "silly") : (p.transports.ipc.level = "info"));
const ip = Object.assign(
  (o) => {
    m.get().windowService.sendDataToMainWin(me.mainLog, o.data.toString());
  },
  { level: "info", transforms: [] },
);
p.transports.ipc = ip;
const op = z.requestSingleInstanceLock();
(op
  ? z.on("second-instance", () => {
      const o = m.get().windowService.mainWin;
      o != null || o != null
        ? (o.isMinimized() && o.restore(), o.show(), o.focus())
        : m.get().windowService.createMainWindow();
    })
  : (z.quit(), process.exit(0)),
  z.whenReady().then(async () => {
    var o, e;
    (await m.get().storageService.ensureInitialized(),
      m.get().applicationService.checkAppSettings(),
      m.get().analyticsService.checkUserConsented(),
      m.get().analyticsService.sendAnalyticsEvent({ event_type: Vt.appStart }),
      m.get().deviceNotifyService.handleDeviceNotify(),
      rp()
        ? process.platform === "darwin" &&
          ((e = (o = z) == null ? void 0 : o.dock) == null || e.hide())
        : m.get().windowService.createMainWindow(),
      m.get().trayService.createNewTray(),
      m.get().applicationService.onThemeChange(),
      m.get().searchDevicesService.devicesListener.on((t) => {
        m.get().devicesCommManager.onDevicesFound(t);
      }),
      m.get().searchDevicesService.bootloaderDevicesListener.on((t) => {
        m.get().windowService.sendDataToMainWin(Ae.onBootloaderDevicesFound, t);
      }),
      m.get().searchDevicesService.start(),
      m.get().devicesCommManager.connectToAllFoundDevices());
  }),
  Qn.on("unlock-screen", async () => {
    (await m.get().devicesCommManager.disconnectAllDevices(),
      m.get().searchDevicesService.resetFoundDevices());
  }),
  z.on("window-all-closed", () => {
    var o;
    ((o = z.dock) == null || o.hide(),
      (m.get().windowService.mainWin = void 0));
  }),
  z.on("activate", () => {
    p.info("activate");
    const o = m.get().windowService;
    o.isMainWindowOpen() ? o.focusMainWindow() : o.createMainWindow();
  }),
  z.on("before-quit", () => {
    (m.get().searchDevicesService.dispose(),
      m.get().storageService.onDestroy(),
      m.get().windowService.onDestroy(),
      m.get().devicesCommManager.disconnectAllDevices());
  }));
