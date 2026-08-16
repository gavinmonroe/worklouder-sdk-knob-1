import { r as _, g as N, j as e, I as T, a as M, F as K, k as R, b as $, d as A, e as z, O as C, f as w, D as F, h as O, c as B } from "./App-DDzLpl7E.js";
const U = "_main_container_4wjd3_1", V = { main_container: U }, H = "_keyboard_kitwj_1", W = "_header_row_kitwj_15", q = "_header_pill_kitwj_26", J = "_encoder_column_kitwj_40", P = "_line_kitwj_62", X = "_joystick_kitwj_68", Y = "_switch_box_kitwj_85", v = { keyboard: H, header_row: W, header_pill: q, encoder_column: J, line: P, joystick: X, switch_box: Y, switch: "_switch_kitwj_85" }, Z = "data:image/svg+xml,%3csvg%20width='30'%20height='30'%20viewBox='0%200%2030%2030'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20y='1.28125'%20width='1.81222'%20height='11.7794'%20rx='0.906108'%20transform='rotate(-45%200%201.28125)'%20fill='white'%20fill-opacity='0.6'/%3e%3crect%20x='19.8623'%20y='21.1445'%20width='1.81222'%20height='11.7794'%20rx='0.906108'%20transform='rotate(-45%2019.8623%2021.1445)'%20fill='white'%20fill-opacity='0.6'/%3e%3crect%20x='28.1914'%20width='1.81222'%20height='11.7794'%20rx='0.906108'%20transform='rotate(45%2028.1914%200)'%20fill='white'%20fill-opacity='0.6'/%3e%3crect%20x='8.3291'%20y='19.8633'%20width='1.81222'%20height='11.7794'%20rx='0.906108'%20transform='rotate(45%208.3291%2019.8633)'%20fill='white'%20fill-opacity='0.6'/%3e%3c/svg%3e", G = "_normal_btn_container_15zcc_1", Q = "_text_row_15zcc_23", I = "_text_column_15zcc_30", ee = "_primary_text_15zcc_38", te = "_merged_key_15zcc_45", j = { normal_btn_container: G, text_row: Q, text_column: I, primary_text: ee, merged_key: te };
function re({ keycode: r, osLayout: h, isSelected: f, width: l, height: i, alignItems: n, mergedDirection: o, actions: p, multiactions: u, smartActions: y }) {
  const a = _.useRef(null), [d, s] = _.useState(false), t = N(r, h, p, u, y);
  _.useLayoutEffect(() => {
    if (!a.current) return;
    const x = a.current, S = () => {
      const L = x.scrollWidth > x.clientWidth || x.scrollHeight > x.clientHeight;
      s(L);
    };
    S();
    const D = new ResizeObserver(S);
    return D.observe(x), () => D.disconnect();
  }, [a]), t.icon !== void 0 && !d && s(true);
  const c = (x) => {
    switch (x) {
      case "key-arrow-up.svg":
        return z;
      case "key-arrow-down.svg":
        return A;
      case "key-arrow-left.svg":
        return $;
      case "key-arrow-right.svg":
        return R;
      case "function-key.svg":
        return K;
      case "add-keycode.svg":
        return M;
      default:
        return "";
    }
  }, m = () => {
    switch (n) {
      case "flex-start":
        return "start";
      default:
        return "center";
    }
  }, g = () => t.img !== void 0 && t.img !== "" ? e.jsx("img", { src: c(t.img) }) : t.icon !== void 0 && t.icon !== "" ? e.jsx(T, { iconCode: t.icon, size: "24px" }) : e.jsxs("div", { className: j.text_row, style: { justifyContent: n }, children: [e.jsxs("div", { className: j.text_column, style: { alignItems: n }, children: [t.secondary !== void 0 && e.jsx("h4", { children: t.secondary }), e.jsx("h4", { ref: a, className: j.primary_text, style: { textAlign: m() }, children: t.primary })] }), (t.third !== void 0 || t.fourth !== void 0) && e.jsxs("div", { className: j.text_column, children: [t.fourth !== void 0 && e.jsx("h4", { children: t.fourth }), t.third !== void 0 && e.jsx("h4", { children: t.third })] })] });
  return o ? e.jsx("div", { style: { width: l, height: i, alignItems: n, justifyContent: n, backgroundColor: f ? void 0 : t.color, border: 0 }, className: `${j.normal_btn_container} `, children: e.jsx("div", { className: `${j.merged_key}`, style: { left: o === "left" ? "-54px" : "0px", top: o === "bottom" ? "-54px" : "0px", width: o === "right" || o === "left" ? "106px" : "52px", height: o === "top" || o === "bottom" ? "106px" : "52px" }, children: g() }) }) : e.jsx("div", { style: { width: l, height: i, alignItems: n, justifyContent: n, backgroundColor: f ? void 0 : t.color }, className: `${j.normal_btn_container}`, children: g() });
}
const ne = "_encoder_1wusd_1", oe = "_divider_1wusd_13", E = { encoder: ne, divider: oe };
function se({}) {
  return e.jsx("div", { className: E.encoder, children: e.jsx("div", { className: E.divider }) });
}
function k({ layer: r, layerIndex: h, actions: f, multiactions: l, smartActions: i }) {
  const [n, o] = _.useState(void 0), p = (d) => {
    o({ type: 1, rowIndex: d, index: d });
  }, u = (d, s) => {
    o({ type: 0, rowIndex: d, index: s });
  }, y = () => {
    o(void 0);
  }, a = () => {
    var _a, _b, _c, _d;
    if (!n) return e.jsx("div", { className: `${v.header_pill}`, style: { justifyContent: "start", flex: 1 }, children: e.jsx("h6", { children: "Action: " }) });
    if (n) {
      if (n.type === 1) {
        const s = ((_a = r.layout.encoders) == null ? void 0 : _a.at(n.rowIndex)).map((t) => {
          if (t == null ? void 0 : t.keycode) return N(t.keycode, r.os ?? C.mac, f, l, i);
        }).filter((t) => t !== void 0);
        return e.jsx("div", { className: v.encoder_column, children: s.map((t, c) => {
          let m = "Left";
          return c === 1 ? m = "Right" : c === 2 && (m = "Click"), e.jsx("div", { className: `${v.header_pill}`, style: { justifyContent: "start", flex: 1 }, children: e.jsxs("h6", { children: [m, ":", t.primary] }) }, c);
        }) });
      } else {
        const d = (_d = (_c = (_b = r.layout.base) == null ? void 0 : _b.at(n.rowIndex)) == null ? void 0 : _c.at(n.index)) == null ? void 0 : _d.keycode;
        if (d) {
          const s = N(d, r.os ?? C.mac, f, l, i);
          return e.jsx("div", { className: `${v.header_pill}`, style: { justifyContent: "start", flex: 1 }, children: e.jsxs("h6", { children: ["Action: ", s.primary] }) });
        }
      }
      return e.jsx("div", { className: `${v.header_pill}`, style: { justifyContent: "start", flex: 1 }, children: e.jsx("h6", { children: "Action: " }) });
    }
  };
  return e.jsxs("div", { className: v.keyboard, children: [e.jsx("div", { className: v.header_row, children: a() }), r.layout.base.map((d, s) => e.jsxs("div", { className: v.line, children: [s === 3 && e.jsx("div", { className: v.switch_box, children: e.jsx("div", { className: v.switch, children: e.jsxs("h6", { children: ["L", h] }) }) }), s == 0 && e.jsx("div", { onMouseEnter: () => p(0), onMouseLeave: y, children: e.jsx(se, {}) }), d.map((t, c) => e.jsx("div", { onMouseEnter: () => {
    u(s, c);
  }, onMouseLeave: y, children: e.jsx(re, { osLayout: r.os ?? C.mac, isSelected: false, keycode: t.keycode, mergedDirection: void 0, actions: f, multiactions: l, smartActions: i }) }, `${s}${c}`)), s === 0 && e.jsx("div", { className: v.joystick, children: e.jsx("img", { src: Z }) })] }, s))] });
}
function ce({ deviceType: r, layer: h, mode: f, layerIndex: l, actions: i, multiactions: n, smartActions: o }) {
  switch (r) {
    case w.DeviceType.NomadE:
    case w.DeviceType.NomadEV2:
      return e.jsx(k, { layer: h, layerIndex: l, actions: i, multiactions: n, smartActions: o });
    case w.DeviceType.Knob:
    case w.DeviceType.KnobF1:
      return e.jsx(k, { layer: h, layerIndex: l, actions: i, multiactions: n, smartActions: o });
    case w.DeviceType.CreatorMicroV2:
      return e.jsx(k, { layer: h, layerIndex: l, actions: i, multiactions: n, smartActions: o });
    case w.DeviceType.XYZ:
      return e.jsx(k, { layer: h, layerIndex: l, actions: i, multiactions: n, smartActions: o });
    case w.DeviceType.CodexMicro:
      return e.jsx(k, { layer: h, layerIndex: l, actions: i, multiactions: n, smartActions: o });
  }
}
var b = ((r) => (r[r.basic = 0] = "basic", r[r.advanced = 1] = "advanced", r))(b || {});
function ie() {
  const [r, h] = _.useState(), [f, l] = _.useState(b.advanced), i = _.useRef(null), n = _.useRef(false), o = () => {
    var _a;
    n.current && (n.current = false, (_a = cheatSheetChannel.stopDrag) == null ? void 0 : _a.call(cheatSheetChannel));
  }, p = (u) => {
    var _a;
    f === b.advanced && u.button === 0 && (n.current || (n.current = true, (_a = cheatSheetChannel.startDrag) == null ? void 0 : _a.call(cheatSheetChannel)));
  };
  return _.useEffect(() => {
    const u = () => o(), y = (d) => {
      n.current && d.buttons === 0 && o();
    }, a = () => o();
    return window.addEventListener("mouseup", u), window.addEventListener("mousemove", y), window.addEventListener("blur", a), () => {
      window.removeEventListener("mouseup", u), window.removeEventListener("mousemove", y), window.removeEventListener("blur", a);
    };
  }, []), _.useEffect(() => {
    var _a, _b;
    const u = (_a = cheatSheetChannel.onInitData) == null ? void 0 : _a.call(cheatSheetChannel, ({ deviceConfig: a, profileIdx: d, layerIdx: s, mode: t }) => {
      try {
        const c = F.fromConfigDataDto(a), m = c.profiles.at(d);
        if (!m) {
          console.error("|CheatSheet| cannot find profile to show"), h(void 0);
          return;
        }
        const g = m.layers.at(s);
        if (!g) {
          console.error("|CheatSheet| cannot find layer to show"), h(void 0);
          return;
        }
        l(t), h({ layer: g, layerIndex: O.deviceHasFpLayer(a.device.deviceType) ? s : s + 1, deviceType: c.deviceInfo.deviceType, actions: c.actions, multiactions: c.multiactions, smartActions: c.smartActions ?? [] });
      } catch (c) {
        console.error("|CheatSheet| error during data init, error: " + c), h(void 0);
      }
    }), y = (_b = cheatSheetChannel.onModeChange) == null ? void 0 : _b.call(cheatSheetChannel, (a) => {
      l(a);
    });
    return () => {
      u == null ? void 0 : u(), y == null ? void 0 : y();
    };
  }, []), _.useEffect(() => {
    if (!r) return;
    const u = requestAnimationFrame(() => {
      var _a;
      if (!i.current) return;
      const { width: y, height: a } = i.current.getBoundingClientRect();
      console.log("|CheatSheet| got first frame"), (_a = cheatSheetChannel.reportWindowSize) == null ? void 0 : _a.call(cheatSheetChannel, Math.ceil(y), Math.ceil(a));
    });
    return () => cancelAnimationFrame(u);
  }, [r]), r ? e.jsx("div", { ref: i, className: V.main_container, onMouseDown: p, style: { cursor: f === b.advanced ? "grab" : "default" }, children: e.jsx(ce, { deviceType: r.deviceType, layer: r.layer, mode: f, layerIndex: r.layerIndex, actions: r.actions, multiactions: r.multiactions, smartActions: r.smartActions }) }) : e.jsx(e.Fragment, {});
}
B.createRoot(document.getElementById("root")).render(e.jsx(ie, {}));
postMessage({ payload: "removeLoading" }, "*");
