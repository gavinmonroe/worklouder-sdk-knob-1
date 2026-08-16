import { r as e, j as o, S as H, g as $, O as g, C as q, K as J, c as X } from "./App-DDzLpl7E.js";
const Y = "_container_1nzl5_1", z = { container: Y };
function G({ onMouseMove: y, yOffset: f = 0, children: M }) {
  const A = e.useRef(null), u = e.useRef(false);
  return e.useEffect(() => {
    const p = y((d) => {
      const v = d.x, R = d.y - f, l = A.current;
      l && (l.style.transform = `translate3d(${Math.round(v)}px, ${Math.round(R)}px, 0) translate(-50%, -50%)`, l.style.willChange = "transform", u.current || (l.style.visibility = "visible", u.current = true));
    });
    return () => {
      p(), u.current = false;
    };
  }, [y, f]), o.jsx("div", { className: z.container, ref: A, children: M });
}
function V() {
  const [y, f] = e.useState(false), [M, A] = e.useState([]), [u, p] = e.useState([]), [d, v] = e.useState([]), [R, l] = e.useState([]), [S, D] = e.useState(-1), j = e.useRef(null), x = e.useRef(0), C = e.useRef(0), m = e.useRef(0), h = e.useRef(0), s = e.useRef(null), i = e.useRef(false), I = 0.25, N = 90, O = 100, T = 100;
  e.useEffect(() => {
    const t = radialMenuChannel.onInitData((c) => {
      try {
        const n = JSON.parse(c), F = n.sectors;
        A([...F]), p(n.actions), v(n.multiactions);
        const K = Array.isArray(n.smartActions) ? n.smartActions : [];
        l(K.map((B) => H.fromDTO(B))), f(true);
        const k = _(n.joystickAngle ?? 0), P = n.distanceFromCenter ?? 0;
        x.current = k, C.current = P, m.current = k, h.current = P, i.current || (s.current = requestAnimationFrame(w), i.current = true);
      } catch (n) {
        console.error(n);
      }
    }), a = radialMenuChannel.onJoystickMove((c) => {
      x.current = _(c.angle), C.current = c.distance, D(c.sectorActive), i.current || (s.current = requestAnimationFrame(w), i.current = true);
    }), r = radialMenuChannel.onHide(() => {
      f(false), s.current && (cancelAnimationFrame(s.current), s.current = null), i.current = false;
    });
    return () => {
      t(), a(), r(), s.current && cancelAnimationFrame(s.current);
    };
  }, []);
  const _ = (t) => Math.abs(t) <= 1.5 ? t * 2 * Math.PI : t * Math.PI / 180, E = (t, a) => {
    let r = t - a;
    for (; r > Math.PI; ) r -= 2 * Math.PI;
    for (; r < -Math.PI; ) r += 2 * Math.PI;
    return r;
  }, L = (t, a) => {
    const r = a * N, c = O + r * Math.cos(t), n = T + r * Math.sin(t);
    return { x: c, y: n };
  }, w = () => {
    const t = E(x.current, m.current);
    m.current += t * I, h.current += (C.current - h.current) * I;
    const { x: a, y: r } = L(m.current, h.current), c = j.current;
    c && (c.style.transform = `translate3d(${Math.round(a)}px, ${Math.round(r)}px, 0) translate(-50%, -50%)`, c.style.willChange = "transform");
    const n = Math.abs(E(x.current, m.current)) < 5e-4, F = Math.abs(C.current - h.current) < 1e-3;
    !n || !F ? (s.current = requestAnimationFrame(w), i.current = true) : (s.current && cancelAnimationFrame(s.current), s.current = null, i.current = false);
  }, b = M == null ? void 0 : M.at(S);
  return y ? o.jsxs(G, { onMouseMove: radialMenuChannel.onMouseMove, yOffset: 12, children: [S != -1 && b && o.jsx("div", { className: "selected_sector_name", children: o.jsx("h4", { children: $(b.k, radialMenuChannel.platform === "win32" ? g.windows : g.mac, u, d, R).primary }) }), o.jsxs("div", { className: "radial_menu_container", children: [o.jsx(q, { keySelected: { row: S, index: S, keyType: J.sector }, osLayout: radialMenuChannel.platform === "win32" ? g.windows : g.mac, showCenter: false, sectorBgColor: "#4A4A4A", sectorSelectedColor: "#2E2E2E", borderColor: "#FFFFFF", hoverActive: false, showButtons: false, isBorderActive: true, borderWidth: 1, deselectKey: () => {
  }, onKeyClick: (t, a, r) => {
  }, sectors: M, addSector: () => {
  }, deleteSector: () => {
  }, actions: u, multiactions: d, smartActions: R }), o.jsx("div", { className: "joystick_circle", ref: j })] })] }) : o.jsx("div", {});
}
X.createRoot(document.getElementById("root")).render(o.jsx(V, {}));
postMessage({ payload: "removeLoading" }, "*");
