import { ah as Z, n as A, i as I, y as B, r, R as $, p as N, s as K, V as W, h as j, j as e, a7 as X, ai as Y, P as M, G as z, f as t, B as G } from "./App-DDzLpl7E.js";
const J = "_navbar_1cvih_1", O = "_logo_box_1cvih_12", Q = "_history_box_1cvih_23", ee = "_history_button_1cvih_32", oe = "_history_icon_1cvih_45", te = "_active_1cvih_52", se = "_navbar__box_1cvih_60", ce = "_navbar__h4_1cvih_80", ne = "_right_box_1cvih_83", ie = "_right_row_1cvih_89", ae = "_connected_box_1cvih_97", s = { navbar: J, logo_box: O, history_box: Q, history_button: ee, history_icon: oe, active: te, navbar__box: se, navbar__h4: ce, right_box: ne, right_row: ie, connected_box: ae }, re = "data:image/svg+xml,%3csvg%20width='47'%20height='14'%20viewBox='0%200%2047%2014'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M23.6867%200.00126465L16.9507%206.7373L23.6867%2013.4733L30.4228%206.7373L23.6867%200.00126465Z'%20fill='white'%20/%3e%3cpath%20d='M13.4727%204.99721H8.47547V0H4.99721V4.99721H0V8.47547H4.99721V13.4727H8.47547V8.47547H13.4727V4.99721Z'%20fill='white'%20/%3e%3cpath%20d='M41.3797%200.354011C39.9001%200.352541%2038.4534%200.790005%2037.2226%201.61104C35.9918%202.43208%2035.0322%203.59978%2034.4653%204.96638C33.8984%206.33298%2033.7496%207.83705%2034.0378%209.28823C34.3259%2010.7394%2035.0381%2012.0725%2036.0842%2013.1188L46.6667%202.54465C45.9734%201.84901%2045.1493%201.29735%2044.2419%200.921393C43.3346%200.545437%2042.3618%200.352612%2041.3797%200.354011Z'%20fill='white'%20/%3e%3c/svg%3e", le = "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20height='24px'%20viewBox='0%20-960%20960%20960'%20width='24px'%20fill='%23e3e3e3'%3e%3cpath%20d='M280-200v-80h284q63%200%20109.5-40T720-420q0-60-46.5-100T564-560H312l104%20104-56%2056-200-200%20200-200%2056%2056-104%20104h252q97%200%20166.5%2063T800-420q0%2094-69.5%20157T564-200H280Z'/%3e%3c/svg%3e", ve = "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20height='24px'%20viewBox='0%20-960%20960%20960'%20width='24px'%20fill='%23e3e3e3'%3e%3cpath%20d='M396-200q-97%200-166.5-63T160-420q0-94%2069.5-157T396-640h252L544-744l56-56%20200%20200-200%20200-56-56%20104-104H396q-63%200-109.5%2040T240-420q0%2060%2046.5%20100T396-280h284v80H396Z'/%3e%3c/svg%3e";
function de({ selectable: _, currentScreen: v, changeScreen: g }) {
  const c = Z(), n = A(), x = I(), p = B(), [C, u] = r.useState(0), [l, y] = r.useState(), [d, m] = r.useState(), [w, f] = r.useState([]), [k, R] = r.useState(() => (c == null ? void 0 : c.hasProfilesUndo()) ?? false), [D, S] = r.useState(() => (c == null ? void 0 : c.hasProfilesRedo()) ?? false), [pe, H] = $(N);
  r.useEffect(() => {
    n.isConnected().then(async (a) => {
      if (a) {
        const h = await n.getConnectedDeviceInfo();
        if (h === void 0) return;
        T(h);
      }
    }), x.getDevices().then((a) => {
      m([...a]);
    });
    const o = x.onDevicesFound((a) => {
      m([...a]);
    }), i = n.onDeviceSelectEvents((a) => {
      n.getConnectedDeviceInfo().then((h) => {
        if (h === void 0) {
          y(void 0), f([]);
          return;
        }
        T(h);
      });
    }), F = c == null ? void 0 : c.onProfileHistoryChange((a) => {
      console.log("|Navbar| profile history changed"), R((c == null ? void 0 : c.hasProfilesUndo()) ?? false), S((c == null ? void 0 : c.hasProfilesRedo()) ?? false);
    });
    return () => {
      i(), o(), F == null ? void 0 : F();
    };
  }, []);
  const V = K();
  W();
  const T = (o) => {
    f(j.getDeviceWidgets(o.deviceType)), y(o);
  }, E = (o) => {
    const i = w[o].value;
    g(i), p.sendSwitchTabEvent(i, v);
  }, U = () => {
    if (C < 4) {
      const o = C + 1;
      u(o);
      return;
    }
    commonChannel.openDevTools(), u(0);
  }, L = async () => {
    d === void 0 || d.length < 2 || (n.deselectDevice(), p.sendDeviceUnselectedEvent(v), H(M.notConnected), V(z.chooseDevice, { state: d }));
  }, P = (o) => {
    switch (o) {
      case t.DeviceType.NomadE:
      case t.DeviceType.NomadEV2:
        return "var(--color-yellow)";
      case t.DeviceType.Knob:
        return "var(--color-knob-accent)";
      case t.DeviceType.CreatorMicroV2:
      case t.DeviceType.KnobF1:
        return "var(--color-micro-v2-accent)";
      case t.DeviceType.CodexMicro:
        return "var(--color-micro-v2-accent)";
      case t.DeviceType.XYZ:
        return "var(--color-xyz-navbar)";
    }
  }, q = (o) => {
    switch (o) {
      case t.DeviceType.NomadE:
      case t.DeviceType.NomadEV2:
        return "var(--color-black)";
      case t.DeviceType.Knob:
        return "var(--color-black)";
      case t.DeviceType.CreatorMicroV2:
      case t.DeviceType.KnobF1:
        return "var(--color-white)";
      case t.DeviceType.CodexMicro:
        return "var(--color-white)";
      case t.DeviceType.XYZ:
        return "var(--color-white)";
    }
  };
  return e.jsxs("div", { className: s.navbar, children: [e.jsx("div", { className: s.logo_box, children: e.jsx("img", { src: re, onClick: () => U() }) }), l && e.jsxs("div", { className: s.history_box, children: [e.jsx("button", { className: s.history_button, disabled: !k, onClick: () => c == null ? void 0 : c.triggerProfileUndo(), children: e.jsx("img", { className: `${s.history_icon} ${k ? s.active : ""}`, src: le }) }), e.jsx("button", { className: s.history_button, disabled: !D, onClick: () => c == null ? void 0 : c.triggerProfileRedo(), children: e.jsx("img", { className: `${s.history_icon} ${D ? s.active : ""}`, src: ve }) })] }), e.jsx("div", { className: `${s.navbar__box}`, style: { pointerEvents: _ ? "all" : "none" }, children: l && w.map((o, i) => o.value && e.jsx("div", { style: { cursor: "pointer" }, className: s.navbar__h4, onClick: () => E(i), children: e.jsx(X.h3, { animate: v === o.value && _ ? { scale: 1.1, color: "#FFF" } : { scale: 1, color: "#808080" }, transition: { type: "spring", stiffness: 400, damping: 25 }, children: o.value }) }, i)) }), e.jsx("div", { className: s.right_box, children: l !== void 0 && e.jsx("div", { className: s.right_row, children: e.jsxs("div", { className: s.connected_box, style: { backgroundColor: P(l.deviceType), color: q(l.deviceType) }, onClick: L, children: [e.jsx("h4", { children: j.getDeviceName(l.deviceType) }), d !== void 0 && d.length > 1 && e.jsx("img", { src: Y, style: { transform: "rotate(90deg)" } })] }) }) })] });
}
const he = "_container_ub6rw_1", _e = "_feedback_ub6rw_10", ge = "_hoverText_ub6rw_34", b = { container: he, feedback: _e, hoverText: ge }, be = "data:image/svg+xml,%3csvg%20width='23'%20height='19'%20viewBox='0%200%2023%2019'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M1.18481%2017.1413C1.18481%2014.9126%204.24031%2013.106%208.00946%2013.106C11.7786%2013.106%2014.8341%2014.9126%2014.8341%2017.1413'%20stroke='%23C0C0C0'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%20/%3e%3cpath%20d='M16.9135%203.19092C17.3359%203.56563%2017.6711%204.01048%2017.8997%204.50007C18.1284%204.98965%2018.246%205.51439%2018.246%206.04431C18.246%206.57424%2018.1284%207.09897%2017.8997%207.58856C17.6711%208.07814%2017.3359%208.52299%2016.9135%208.89771'%20stroke='%23C0C0C0'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%20/%3e%3cpath%20d='M8.00948%2010.0794C10.5222%2010.0794%2012.5592%208.27274%2012.5592%206.0441C12.5592%203.81546%2010.5222%202.00879%208.00948%202.00879C5.49672%202.00879%203.45972%203.81546%203.45972%206.0441C3.45972%208.27274%205.49672%2010.0794%208.00948%2010.0794Z'%20stroke='%23C0C0C0'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%20/%3e%3cpath%20d='M19.3839%201C20.1308%201.66241%2020.7232%202.44879%2021.1274%203.31427C21.5316%204.17974%2021.7396%205.10735%2021.7396%206.04413C21.7396%206.98092%2021.5316%207.90852%2021.1274%208.774C20.7232%209.63947%2020.1308%2010.4259%2019.3839%2011.0883'%20stroke='%23C0C0C0'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%20/%3e%3c/svg%3e", xe = "https://feedback.worklouder.cc/";
function ue({ children: _, currentScreen: v, changeCurrentScreen: g }) {
  const c = G(N), n = () => {
    commonChannel.openExternalTab(xe);
  };
  return e.jsxs("div", { className: b.container, children: [e.jsx(de, { selectable: c === M.completed, currentScreen: v, changeScreen: g }), _, e.jsxs("div", { className: b.feedback, onClick: n, children: [e.jsx("img", { style: { width: "18px" }, src: be }), e.jsx("h4", { className: b.hoverText, children: "give feedback" })] })] });
}
export {
  ue as M
};
