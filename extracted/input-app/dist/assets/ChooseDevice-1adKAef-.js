import { s as R, V as L, n as M, i as S, y as q, r as a, R as U, p as B, j as e, X as x, T as F, a7 as l, h as p, f as i, P as f, a8 as K, G as V } from "./App-DDzLpl7E.js";
import { M as A } from "./MainScaffold-D3RakiUq.js";
const P = "_page_lq1f8_1", O = "_header_lq1f8_9", X = "_devices_list_lq1f8_18", Y = "_big_devices_list_scroll_lq1f8_37", H = "_big_devices_list_lq1f8_37", Z = "_small_devices_list_scroll_lq1f8_58", Q = "_small_devices_list_lq1f8_58", W = "_device_lq1f8_18", z = "_image_lq1f8_93", G = "_label_container_lq1f8_101", J = "_icon_lq1f8_113", t = { page: P, header: O, devices_list: X, big_devices_list_scroll: Y, big_devices_list: H, small_devices_list_scroll: Z, small_devices_list: Q, device: W, image: z, label_container: G, icon: J }, $ = "" + new URL("nomad_e-C16y4FMr.svg", import.meta.url).href, ee = "" + new URL("knob_1-BtI0Q3Fd.svg", import.meta.url).href, se = "" + new URL("framer_f1-CDBT_8Rj.svg", import.meta.url).href, te = "" + new URL("creato_micro_v2--xbgKKTE.svg", import.meta.url).href, ie = "" + new URL("codex_micro-DsTqfYx_.svg", import.meta.url).href, ce = "" + new URL("xyz-BO1Qts6f.svg", import.meta.url).href, y = "data:image/svg+xml,%3csvg%20width='10'%20height='18'%20viewBox='0%200%2010%2018'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='2'%20width='6'%20height='6'%20rx='0.692841'%20fill='%23D8D8D8'/%3e%3crect%20y='5'%20width='10'%20height='13'%20rx='1.03926'%20fill='%23F2F2F2'/%3e%3c/svg%3e", C = "data:image/svg+xml,%3csvg%20width='11'%20height='14'%20viewBox='0%200%2011%2014'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M1%208.71429L10%204.42857L4.9375%201V13L10%209.14286L1%205.28571'%20stroke='white'%20stroke-linejoin='bevel'/%3e%3c/svg%3e";
function re({ handleDeviceConnected: b }) {
  const n = R(), D = L(), j = M(), w = S(), N = q(), [T, d] = a.useState(false), [k, r] = a.useState(false), [o, I] = a.useState(D.state ?? []), [, v] = U(B);
  if (o.length <= 1) {
    n("/");
    return;
  }
  a.useEffect(() => {
    const s = w.onDevicesFound((c) => {
      if (I(c), c.length <= 1) {
        n("/");
        return;
      }
    });
    return () => {
      s();
    };
  }, []);
  const _ = async (s) => {
    if (!k) {
      r(true), d(false);
      try {
        if (v(f.connecting), await j.selectAndConnectDevice(s.id)) {
          N.sendDeviceSelectedEvent(s, K.chooseDevice), b(), n(V.main, { state: { tab: x.keymap } });
          return;
        }
      } catch {
        v(f.notConnected), r(false);
        return;
      }
      d(true), r(false);
    }
  }, E = () => {
    n("/");
  }, m = (s) => {
    switch (s.deviceType) {
      case i.DeviceType.NomadE:
      case i.DeviceType.NomadEV2:
        return $;
      case i.DeviceType.Knob:
        return ee;
      case i.DeviceType.KnobF1:
        return se;
      case i.DeviceType.CreatorMicroV2:
        return te;
      case i.DeviceType.CodexMicro:
        return ie;
      case i.DeviceType.XYZ:
        return ce;
    }
  }, g = (s) => {
    switch (s.deviceType) {
      case i.DeviceType.NomadE:
      case i.DeviceType.NomadEV2:
        return true;
      case i.DeviceType.Knob:
      case i.DeviceType.KnobF1:
        return true;
      case i.DeviceType.CreatorMicroV2:
        return false;
      case i.DeviceType.CodexMicro:
        return false;
      case i.DeviceType.XYZ:
        return true;
    }
  }, h = o.filter((s) => !g(s)), u = o.filter((s) => g(s));
  return e.jsx(A, { changeCurrentScreen: () => {
  }, currentScreen: x.undefined, children: e.jsxs("div", { className: t.page, children: [e.jsxs("div", { className: t.header, children: [e.jsx("h2", { children: "Welcome" }), e.jsx("h1", { children: "Select your device" })] }), T ? e.jsx(F, { onClick: E, text: "We had an error when trying to connect. Please retry!", textColor: "var(--color-black", backgroundColor: "var(color-red)" }) : e.jsxs(l.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: "easeOut" }, className: t.devices_list, children: [u.length > 0 && e.jsx("div", { className: t.big_devices_list_scroll, children: e.jsx("div", { className: t.big_devices_list, children: u.map((s, c) => e.jsxs(l.div, { className: t.device, onClick: () => {
    _(s);
  }, whileHover: { scale: 1.02 }, transition: { duration: 0.3, ease: "easeOut" }, children: [e.jsx("div", { className: t.image, children: e.jsx("img", { src: m(s) }) }), e.jsxs("div", { className: t.label_container, children: [e.jsx("h5", { children: p.getDeviceName(s.deviceType) }), e.jsx("div", { className: t.icon, style: { justifyContent: "end", alignItems: "center", backgroundColor: s.isUsbConnection ? "var(--color-green)" : "" }, children: e.jsx("img", { width: "10px", src: y }) }), e.jsx("div", { className: t.icon, style: { justifyContent: "center", alignItems: "center", backgroundColor: s.isUsbConnection ? "" : "#1C4CEC" }, children: e.jsx("img", { width: "12px", src: C }) })] })] }, c)) }) }), h.length > 0 && e.jsx("div", { className: t.small_devices_list_scroll, children: e.jsx("div", { className: t.small_devices_list, children: h.map((s, c) => e.jsx(l.div, { className: t.device, onClick: () => {
    _(s);
  }, whileHover: { scale: 1.02 }, transition: { duration: 0.3, ease: "easeOut" }, children: e.jsxs("div", { className: t.image, children: [e.jsx("img", { src: m(s) }), e.jsxs("div", { className: t.label_container, children: [e.jsx("h5", { children: p.getDeviceName(s.deviceType) }), e.jsx("div", { className: t.icon, style: { justifyContent: "end", alignItems: "center", backgroundColor: s.isUsbConnection ? "var(--color-green)" : "" }, children: e.jsx("img", { width: "10px", src: y }) }), e.jsx("div", { className: t.icon, style: { justifyContent: "center", alignItems: "center", backgroundColor: s.isUsbConnection ? "" : "#1C4CEC" }, children: e.jsx("img", { width: "12px", src: C }) })] })] }) }, c)) }) })] })] }) });
}
export {
  re as default
};
