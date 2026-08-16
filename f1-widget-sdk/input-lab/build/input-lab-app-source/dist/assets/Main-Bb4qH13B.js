import { j as e, i as Q, R as D, l as ee, p as $, r, m as we, P as o, n as O, o as ae, q as Ce, u as je, s as te, t as L, f as w, L as ke, v as De, w as Se, x as Fe, y as ie, z as Ne, B as b, E as le, G as de, H as Le, J as Te, M as Ee, N as Be, Q as oe, T as se, U as Re, V as Me, W as Ie, X as J, Y as Ae, Z as Ue, _ as $e, $ as Ke, a0 as Ge, a1 as Ve, a2 as He, a3 as We, a4 as Ze, a5 as qe, a6 as ze } from "./App-DDzLpl7E.js";
import { M as Ye } from "./MainScaffold-D3RakiUq.js";
const Oe = "_connection_15655_1", Xe = "_connection__text_15655_10", Je = "_setup_15655_21", Pe = "_hoverText_15655_36", W = { connection: Oe, connection__text: Xe, setup: Je, hoverText: Pe }, Qe = "data:image/svg+xml,%3csvg%20width='22'%20height='22'%20viewBox='0%200%2022%2022'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M10.9999%2014.6666C13.025%2014.6666%2014.6666%2013.025%2014.6666%2010.9999C14.6666%208.97487%2013.025%207.33325%2010.9999%207.33325C8.97487%207.33325%207.33325%208.97487%207.33325%2010.9999C7.33325%2013.025%208.97487%2014.6666%2010.9999%2014.6666Z'%20stroke='%23C0C0C0'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%20/%3e%3cpath%20d='M17.5699%207.27837L17.5096%207.174C17.3433%206.88616%2017.2584%206.55852%2017.264%206.22614L17.2915%204.59556C17.2971%204.26232%2017.1214%203.9523%2016.8326%203.7859L14.324%202.34031C14.036%202.17433%2013.6806%202.17731%2013.3954%202.34809L12.0029%203.18187C11.7183%203.35228%2011.3928%203.44229%2011.0611%203.44229H10.9404C10.6079%203.44229%2010.2817%203.35189%209.99672%203.18078L8.59783%202.34096C8.31161%202.16913%207.9546%202.16648%207.66587%202.33406L5.16521%203.78541C4.87785%203.9522%204.70323%204.26143%204.70882%204.59364L4.73628%206.22614C4.74188%206.55852%204.65699%206.88616%204.49072%207.17401L4.43124%207.27697C4.26487%207.56498%204.02329%207.8023%203.73237%207.96352L2.30706%208.75338C2.01492%208.91528%201.83396%209.22325%201.83472%209.55725L1.84128%2012.4464C1.84204%2012.7784%202.02221%2013.084%202.31231%2013.2454L3.73078%2014.0345C4.02269%2014.1969%204.26469%2014.436%204.43063%2014.7259L4.49436%2014.8372C4.6583%2015.1236%204.74189%2015.4489%204.73632%2015.7789L4.70888%2017.4043C4.70325%2017.7375%204.87895%2018.0476%205.16774%2018.214L7.67632%2019.6595C7.96436%2019.8255%208.31969%2019.8226%208.60491%2019.6518L9.9974%2018.818C10.282%2018.6476%2010.6075%2018.5576%2010.9392%2018.5576H11.0599C11.3924%2018.5576%2011.7186%2018.648%2012.0036%2018.8191L13.4025%2019.6589C13.6887%2019.8307%2014.0457%2019.8334%2014.3344%2019.6658L16.8351%2018.2144C17.1225%2018.0477%2017.2971%2017.7384%2017.2915%2017.4062L17.264%2015.7737C17.2584%2015.4413%2017.3433%2015.1137%2017.5096%2014.8259L17.5691%2014.7229C17.7354%2014.4349%2017.977%2014.1976%2018.2679%2014.0363L19.6932%2013.2465C19.9854%2013.0846%2020.1664%2012.7766%2020.1656%2012.4426L20.159%209.55344C20.1583%209.22147%2019.9781%208.91585%2019.688%208.75446L18.2661%207.96346C17.9764%207.80226%2017.7357%207.5655%2017.5699%207.27837Z'%20stroke='%23C0C0C0'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%20/%3e%3c/svg%3e", et = "_container_19rdr_1", tt = "_connector_19rdr_6", nt = "_plastic_19rdr_15", ot = "_wire_19rdr_24", Z = { container: et, connector: tt, plastic: nt, wire: ot };
function st({ wireHeight: t }) {
  return e.jsxs("div", { className: Z.container, children: [e.jsx("div", { className: Z.connector, style: { bottom: t + 74 } }), e.jsx("div", { className: Z.plastic, style: { bottom: t } }), e.jsx("div", { className: Z.wire, style: { height: t } })] });
}
function ct() {
  const t = Q(), [n, h] = D(ee), [, d] = D($), [f, u] = r.useState(false);
  return r.useEffect(() => {
    t.getBootloaderDevices().then((p) => {
      p.length >= 1 ? u(true) : u(false);
    });
    const S = t.onBootloaderDevicesFound((p) => {
      p.length >= 1 ? u(true) : u(false);
    });
    return () => {
      S();
    };
  }, []), n ? e.jsx(we, { onBackClick: () => h(false) }) : e.jsxs("div", { className: W.connection, children: [e.jsxs("div", { className: W.connection__text, children: [e.jsx("h2", { children: "No device found" }), e.jsx("h1", { children: "Please connect your device" }), e.jsx("h4", { onClick: () => d(o.flashAvailable), style: { transition: "opacity 0.3s ease", opacity: f ? 1 : 0, visibility: f ? "visible" : "hidden", textDecoration: "underline", cursor: "pointer" }, children: "Found device in bootloader mode, click here to reflash" })] }), e.jsx(st, { wireHeight: 240 }), e.jsxs("div", { className: W.setup, onClick: () => h(true), children: [e.jsx("img", { style: { width: "18px" }, src: Qe }), e.jsx("h4", { className: W.hoverText, children: "developer mode" })] })] });
}
const rt = "_container_n9cvv_1", at = "_title__container_n9cvv_11", it = "_layouts__container_n9cvv_18", lt = "_layout_n9cvv_18", q = { container: rt, title__container: at, layouts__container: it, layout: lt }, dt = [{ type: L.uk, name: "English - UK" }, { type: L.it, name: "Italian" }, { type: L.es, name: "Spanish" }, { type: L.de, name: "German" }, { type: L.nr, name: "Nordic" }, { type: L.fr, name: "French" }];
function ce({ handleDeviceConnected: t }) {
  const n = O(), h = ae(), [d, f] = D($), [, u] = D(Ce), S = je();
  te(), r.useEffect(() => {
    (async () => {
      const l = await n.getConnectedDeviceInfo();
      if ((l == null ? void 0 : l.layoutType) == w.DeviceLayoutType.ansi || (l == null ? void 0 : l.layoutType) == w.DeviceLayoutType.universal) {
        const g = { type: L.us };
        p(g);
      }
    })();
  }, []);
  const p = async (v) => {
    const l = await n.getConnectedDeviceInfo();
    if (l === void 0) {
      console.error("|LAYOUT| cannot find connected device"), f(o.notConnected);
      return;
    }
    const g = y(l.deviceType, v);
    if (h.updateKeyboardLanguage(l, v.type), ke.setLanguage(v.type), De.instance.setKeyboardLayout(g), d === o.reset) {
      S({ id: 0, language: v.type, deviceType: l.deviceType, deviceLayoutType: l.layoutType }), f(o.completed);
      return;
    }
    t();
  }, y = (v, l) => {
    let g = w.DeviceLayoutType.iso;
    l.type === L.us && (g = v === w.DeviceType.CreatorMicroV2 ? w.DeviceLayoutType.universal : w.DeviceLayoutType.ansi);
    const C = new Se(v, l.type, g);
    return u(C), C;
  }, i = () => "select your layout";
  return e.jsxs("div", { className: q.container, children: [e.jsxs("div", { className: q.title__container, children: [e.jsx("h2", { children: "Welcome" }), e.jsx("h1", { children: i() })] }), e.jsx("div", { className: q.layouts__container, children: dt.map((v, l) => e.jsx("div", { className: q.layout, onClick: () => p(v), children: e.jsx("h5", { children: v.name }) }, l)) })] });
}
const ut = "_container_emzjb_1", vt = "_ready__container_emzjb_11", gt = "_text__container_emzjb_21", ht = "_button_emzjb_28", z = { container: ut, ready__container: vt, text__container: gt, button: ht }, ft = "_container_1br5q_1", mt = "_percentage_1br5q_11", pt = "_update__percentage_1br5q_19", _t = "_button_1br5q_24", Y = { container: ft, percentage: mt, update__percentage: pt, button: _t };
function yt({ flashPercentageSmooth: t, onGoToChangelogClick: n }) {
  return e.jsxs("div", { className: Y.container, children: [e.jsx("h1", { style: { color: "#000" }, children: "Your device has been updated!" }), e.jsx("div", { className: Y.percentage, children: e.jsxs("h1", { className: Y.update__percentage, children: [(t * 100).toFixed(0), " %"] }) }), e.jsx("div", { className: Y.button, style: { backgroundColor: "var(--color-black)", color: "var(--color-white)" }, onClick: n, children: e.jsx("h4", { children: "Open editor" }) })] });
}
const xt = "_container_1kopj_1", bt = "_title_1kopj_11", wt = "_subtitle_1kopj_15", Ct = "_percentage_1kopj_19", jt = "_update__percentage_1kopj_27", H = { container: xt, title: bt, subtitle: wt, percentage: Ct, update__percentage: jt };
function kt({ flashPercentageSmooth: t }) {
  return e.jsxs("div", { className: H.container, children: [e.jsx("h1", { className: H.title, children: "Do not disconnect" }), e.jsx("h2", { className: H.subtitle, children: "Update in progress" }), e.jsx("div", { className: H.percentage, children: e.jsxs("h1", { className: H.update__percentage, children: [(t * 100).toFixed(0), " %"] }) })] });
}
const Dt = "_container_xm6bi_1", St = "_row_xm6bi_11", Ft = "_button_xm6bi_17", Nt = "_noThanks_xm6bi_34", Lt = "_warning_xm6bi_39", k = { container: Dt, row: St, button: Ft, noThanks: Nt, warning: Lt };
function Tt({ onGoBackPressed: t, onInstallClick: n }) {
  return e.jsxs("div", { className: k.container, children: [e.jsx("h1", { children: "We detected a keyboard that can be flashed!" }), e.jsx("h2", { children: "Do you want install the latest fimware update?" }), e.jsxs("div", { className: k.row, children: [e.jsx("div", { className: k.button, onClick: () => n(w.DeviceType.NomadE), children: e.jsx("h4", { children: "Install nomad firmware" }) }), e.jsx("div", { className: k.button, onClick: () => n(w.DeviceType.NomadEV2), children: e.jsx("h4", { children: "Install nomadE v2 firmware" }) }), e.jsx("div", { className: k.button, onClick: () => n(w.DeviceType.Knob), children: e.jsx("h4", { children: "Install knob firmware" }) }), e.jsx("div", { className: k.button, onClick: () => n(w.DeviceType.KnobF1), children: e.jsx("h4", { children: "Install KnobF1 firmware" }) }), e.jsx("div", { className: k.button, onClick: () => n(w.DeviceType.CreatorMicroV2), children: e.jsx("h4", { children: "Install Creator Micro V2 firmware" }) }), e.jsx("div", { className: k.button, onClick: () => n(w.DeviceType.XYZ), children: e.jsx("h4", { children: "Install XYZ R2 fimware" }) })] }), e.jsx("div", { onClick: t, children: e.jsx("h4", { className: k.noThanks, children: "no, thanks" }) }), e.jsxs("h5", { className: k.warning, children: ["\u26A0\uFE0F Ensure the keyboard is properly connected to your computer.", e.jsx("br", {}), "If you have other USB devices plugged in, disconnect them before proceeding."] })] });
}
const Et = "_update_available_2h24i_1", Bt = { update_available: Et }, Rt = "_button_8vfm0_1", Mt = { button: Rt };
function P({ onClick: t, label: n }) {
  return e.jsx("div", { className: Mt.button, onClick: t, children: e.jsx("h4", { children: n }) });
}
function It({ deviceInfo: t, startUpdate: n, skipUpdate: h }) {
  return e.jsxs("div", { className: Bt.update_available, children: [t.isUsbConnection ? e.jsx(P, { label: "download", onClick: n }) : e.jsxs("h3", { style: { color: "var(--color-black)" }, children: ["The selected device is not communicating via USB.", e.jsx("br", {}), "Please plug in the device \u{1F50C}, or switch it to USB communication mode if it is already connected."] }), e.jsx(P, { label: "skip update", onClick: h })] });
}
const At = "_body_container_1hq6i_1", Ut = { body_container: At };
function $t({ updatePhase: t }) {
  const n = () => {
    switch (t) {
      case U.Backup:
        return "backing up your files...";
      case U.Downloading:
        return "downloading...";
      case U.Bootloading:
        return "sending device in bootloader mode...";
      case U.RestoringBackup:
        return "restoring your files...";
      default:
        return "";
    }
  };
  return e.jsx("div", { className: Ut.body_container, children: e.jsx(e.Fragment, { children: e.jsx("h4", { children: n() }) }) });
}
var U = ((t) => (t[t.Unknown = 0] = "Unknown", t[t.Idle = 1] = "Idle", t[t.Backup = 2] = "Backup", t[t.Downloading = 3] = "Downloading", t[t.Bootloading = 4] = "Bootloading", t[t.BootloaderComplete = 5] = "BootloaderComplete", t[t.Updating = 6] = "Updating", t[t.RestoringBackup = 7] = "RestoringBackup", t[t.Completed = 8] = "Completed", t[t.CreateBackupError = 9] = "CreateBackupError", t[t.RestoreBackupError = 10] = "RestoreBackupError", t[t.DownloadError = 11] = "DownloadError", t[t.BootloadingError = 12] = "BootloadingError", t[t.FlashAvailable = 13] = "FlashAvailable", t[t.Error = 14] = "Error", t))(U || {});
function re({ phase: t = 1, handleDeviceConnected: n }) {
  const h = Q(), d = O(), f = Fe(), u = ie(), [S, p] = D($), [y, i] = D(ee), [, v] = D(Ne), l = b(le), [g, C] = r.useState(void 0), [T, F] = r.useState(l == null ? void 0 : l.deviceType), [x, j] = r.useState(), [E, R] = r.useState(0), [M, K] = r.useState(0), [c, m] = r.useState(t), [G, X] = r.useState(""), [_, I] = r.useState({}), A = te();
  r.useEffect(() => {
    c === 6 && y === false && i(true);
  }, [c]), r.useEffect(() => {
    (async () => {
      const s = await d.fetchFwUpdateInfo();
      if (!s) {
        console.error("|Update| got to update page with not update info");
        return;
      }
      j(s);
    })();
  }, []), r.useEffect(() => {
    const a = setInterval(() => {
      c === 6 && K(E * 0.05 + M * 0.95);
    }, 30);
    return () => clearInterval(a);
  }), r.useEffect(() => {
    c === 2 && V(c);
  }, [x]);
  const V = async (a) => {
    let s = a;
    if ((s === 1 || s === 9 || s === 14) && (m(2), await fe(), s = 2), s === 2 || s === 11) {
      if (m(3), i(true), !await ve()) {
        m(11), g && u.sendUpdateError(g, "download_error");
        return;
      }
      s = 3;
    }
    if (s === 3 || s === 12) {
      if (m(4), !await ue()) {
        m(12), g && u.sendUpdateError(g, "bootload_error");
        return;
      }
      m(5);
    }
  }, ue = async () => {
    try {
      if (await d.getConnectedDeviceInfo() !== void 0) {
        if (!await d.sendDeviceIntoBootloader()) return console.error("Failed to send device into bootloader mode"), false;
        const N = await h.getBootloaderDevices();
        if (N.length > 0) C(N[0]);
        else return console.error("Cannot find any device in bootloader mode"), C(void 0), false;
      } else {
        const s = await h.getBootloaderDevices();
        if (s.length > 0) C(s[0]);
        else return console.error("Cannot find any device in bootloader mode"), C(void 0), false;
      }
      return true;
    } catch (a) {
      return console.error("Send into bootloader error: " + a), false;
    }
  }, ve = async () => {
    try {
      if ((x == null ? void 0 : x.downloadUrl) === void 0 || x.downloadUrl === "") {
        console.error("|Update| donwload url is null or empty");
        return;
      }
      let a = await f.downloadFile(x.downloadUrl);
      return console.log("Firmware downloaded successfully", a), X(a), await new Promise((s) => setTimeout(s, 2 * 1e3)), true;
    } catch (a) {
      return console.error(a), false;
    }
  }, ge = () => {
    m(2);
  }, he = async () => {
    v(null), m(6);
    try {
      if (g === void 0) {
        console.error("No device found for flashing");
        return;
      }
      await h.flashDevice(g, G, (s, N) => {
        R(s / N);
      }, (s) => {
        console.log(s);
      }), R(1), K(1), f.deleteFile(G), await new Promise((s) => setTimeout(s, 5e3));
      const a = await ne();
      if (u.sendDeviceUpdated(g, (x == null ? void 0 : x.version) ?? ""), T && (x == null ? void 0 : x.version) && v({ deviceType: T, firmwareVersion: x.version }), !a) {
        console.error("Error while restoring files to keyboard"), m(8);
        return;
      }
      m(8);
    } catch (a) {
      console.error(a), m(14), g && u.sendUpdateError(g, "generic_error");
    }
  }, ne = async () => {
    console.log("|Update| Restoring backup files to keyboard"), m(7);
    const s = (await h.getDevices()).filter((N) => N.devicePid === (g == null ? void 0 : g.devicePid));
    return s.length < 1 ? (console.error("|Update| could not find device to connect"), false) : d.restoreBackupFiles(s[0].id, _);
  }, fe = async () => {
    console.log("|Update| Backing up files..."), m(2);
    const a = await d.backupFiles();
    return a ? (I(a), true) : false;
  }, me = () => {
    console.log("|Update| Error pressed with phase " + c), c === 9 || c === 14 || c === 11 || c === 12 ? V(2) : c === 10 && ne();
  }, pe = () => {
    v(null), p(o.notConnected);
  }, _e = () => {
    i(false), p(o.notConnected), A(de.root);
  }, ye = () => {
    v(null), i(false), n(true);
  }, xe = async (a) => {
    try {
      F(a), ge();
      const s = await h.getLatestFwRelease(a);
      j(s), u.sendFlashAvailableInstallClicked(a);
    } catch {
      console.error("|Update| error on install click"), m(14);
    }
  }, be = () => {
    if (c === 1) return e.jsx(It, { deviceInfo: l, startUpdate: () => V(c), skipUpdate: ye });
    if (c === 2 || c === 3 || c === 4 || c === 7) return e.jsx($t, { updatePhase: c });
    if (c === 5) return e.jsx(P, { label: "install", onClick: he });
    if (c === 14 || c === 9 || c === 10 || c === 11 || c === 12) return e.jsx("div", { className: z.button, style: { backgroundColor: "var(--color-red)" }, onClick: me, children: e.jsx("h4", { children: "We had an error! Retry!" }) });
  };
  switch (c) {
    case 13:
      return e.jsx(Tt, { onGoBackPressed: pe, onInstallClick: xe });
    case 6:
      return e.jsx(kt, { flashPercentageSmooth: M });
    case 8:
      return e.jsx(yt, { flashPercentageSmooth: M, onGoToChangelogClick: _e });
    default:
      return e.jsx("div", { className: z.container, children: e.jsxs("div", { className: z.ready__container, children: [e.jsxs("div", { className: z.text__container, children: [e.jsx("h1", { children: "New firmware update available!" }), e.jsxs("h2", { children: ["Firmware version: ", e.jsx("b", { children: x == null ? void 0 : x.version })] })] }), be()] }) });
  }
}
const Kt = "data:image/svg+xml,%3csvg%20width='20'%20height='20'%20viewBox='0%200%2020%2020'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M19.9989%207.41788H12.581V0H7.41788V7.41788H0V12.581H7.41788V19.9989H12.581V12.581H19.9989V7.41788Z'%20fill='%23C0C0C0'/%3e%3c/svg%3e", Gt = "data:image/svg+xml,%3csvg%20width='21'%20height='20'%20viewBox='0%200%2021%2020'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M10.1606%200.00198152L0.16156%2010.001L10.1606%2020L20.1596%2010.001L10.1606%200.00198152Z'%20fill='%23C0C0C0'/%3e%3c/svg%3e", Vt = "data:image/svg+xml,%3csvg%20width='20'%20height='20'%20viewBox='0%200%2020%2020'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M11.424%200.525391C5.29273%200.525391%200.324036%205.49409%200.324036%2011.6253C0.324036%2014.6909%201.56518%2017.4669%203.57582%2019.4735L19.2721%203.77718C17.2656%201.77067%2014.4896%200.525391%2011.424%200.525391Z'%20fill='%23C0C0C0'/%3e%3c/svg%3e", Ht = "_image_transition_14ojv_1", Wt = "_image_14ojv_1", Zt = "_image1_14ojv_16", qt = "_image2_14ojv_21", zt = "_image3_14ojv_26", B = { image_transition: Ht, image: Wt, image1: Zt, image2: qt, image3: zt };
function Yt() {
  return e.jsxs("div", { className: B.image_transition, children: [e.jsx("img", { src: Kt, className: `${B.image} ${B.image1}` }), e.jsx("img", { src: Gt, className: `${B.image} ${B.image2}` }), e.jsx("img", { src: Vt, className: `${B.image} ${B.image3}` })] });
}
const Ot = "_column_1glv6_1", Xt = { column: Ot };
function Jt() {
  const t = b($), [n, h] = r.useState("Trying to connect to keyboard..."), d = () => {
    switch (t) {
      case o.connecting:
        return "Trying to connect to keyboard...";
      case o.fetchKeyboardData:
        return "Retrieving keyboard data...";
      default:
        return "";
    }
  };
  return r.useEffect(() => {
    const f = d();
    h(f);
  }, [t]), e.jsxs("div", { className: Xt.column, children: [e.jsx(Yt, {}), e.jsx("h2", { style: { color: "var(--color-dark-grey)", marginTop: "18px" }, children: n })] });
}
const Pt = "_column_1ahbh_1", Qt = { column: Pt }, en = new Be();
function tn({ handleDeviceConnected: t }) {
  const n = O(), h = ae(), [d, f] = r.useState(0), [u, S] = r.useState(false), [p, y] = D($), i = r.useRef(p);
  i.current = p;
  const v = Le();
  r.useEffect(() => {
    const F = n.onDeviceSelectEvents((j) => {
      j || (i.current === o.completed || i.current === o.fetchKeyboardData || i.current === o.fetchError) && (h.resetDeviceConfig(), y(o.notConnected));
    }), x = n.onFileFetchEvent(async (j) => {
      if (j.fileName !== Te && j.fileName !== Ee) return;
      const E = await en.execute(n);
      if (E === oe.error) {
        f(5), console.log("|Fetch error| fetch data error");
        return;
      }
      E === oe.fetched && (console.log("|FetchError| fetch data finished"), await n.getConnectedDeviceInfo() ? t() : y(o.notConnected));
    });
    return () => {
      x(), F();
    };
  }, []), r.useEffect(() => {
    if (console.log("|FetchError| retry timer is, " + d), d !== -1) {
      if (d === 0) {
        f(-1), l();
        return;
      }
      setTimeout(() => f((F) => F - 1), 1e3);
    }
  }, [d]);
  const l = async () => {
    console.log("|FetchError| silent retry"), await n.clearCache(), n.fetchDeviceData();
  }, g = async () => {
    console.log("|FetchError| retrying"), await n.clearCache(), n.fetchDeviceData(), y(o.notConnected);
  }, C = async () => {
    if (!u) {
      S(true);
      return;
    }
    if (console.log("|FetchError| resetting to default state"), !await n.getConnectedDeviceInfo()) {
      console.error("|FetchError| cannot get device info, disconnecting"), await n.disconnect(), y(o.notConnected);
      return;
    }
    v();
  }, T = () => d === 0 ? "Retry in progress" : d > 0 ? `Retry in ${d}` : "Retry";
  return e.jsxs("div", { className: Qt.column, children: [e.jsx("h2", { style: { textAlign: "start", marginBottom: "10px" }, children: "There has been an error when fetching the data from the keyboard." }), e.jsx("h4", { style: { textAlign: "start", marginBottom: "20px" }, children: "Would you like to retry or to reset the keyboard to the factory state?" }), e.jsx(se, { text: T(), onClick: g, marginBottom: "10px" }), e.jsx(Re, { onClickOutside: () => {
    S(false);
  }, children: e.jsx(se, { text: u ? "Are you sure? Click to continue reset" : "Reset to factory state", onClick: () => {
    C();
  }, backgroundColor: u ? "var(--color-red)" : "", textColor: u ? "var(--color-white)" : "" }) })] });
}
function nn({ phase: t, handleDeviceConnected: n }) {
  return e.jsxs("div", { style: { display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" }, children: [t === o.undefined && e.jsx("div", {}), t === o.connecting || t === o.fetchKeyboardData && e.jsx(Jt, {}), t === o.fetchError && e.jsx(tn, { handleDeviceConnected: n }), t === o.notConnected && e.jsx(ct, {}), t === o.update && e.jsx(re, { handleDeviceConnected: n }), t === o.layout && e.jsx(ce, { handleDeviceConnected: n }), t === o.reset && e.jsx(ce, { handleDeviceConnected: n }), t === o.flashAvailable && e.jsx(re, { phase: U.FlashAvailable, handleDeviceConnected: n })] });
}
function cn({ handleDeviceConnected: t }) {
  const n = te(), h = Me(), d = Ie(), f = O(), u = Q(), S = ie(), [p, y] = r.useState(J.keymap), [i, v] = D($), [l, g] = D(ee), C = b(le), T = b(Ae), F = b(Ue), x = b($e), j = b(Ke), E = b(Ge), R = b(Ve), M = b(He), K = b(We), c = b(Ze), m = b(qe);
  r.useEffect(() => {
    const _ = h.state.tab;
    console.log("Navigated in main screen with tab " + _), _ !== void 0 && y(_);
  }, []), r.useEffect(() => {
    const _ = async () => {
      if (!(l || await f.isConnected() === false && i !== o.flashAvailable && (console.log("|Main| check device, phase " + i.toString()), v(o.notConnected), await G()))) {
        if (i === o.flashAvailable && (console.log("|Main| check device, phase flashAvailable"), (await u.getBootloaderDevices()).length < 1)) {
          v(o.notConnected);
          return;
        }
        if (i === o.notConnected && (console.log("|Main| check device, phase not connected"), G()), i === o.layout) {
          y(J.keymap);
          return;
        }
      }
    };
    _();
    const I = u.onDevicesFound((A) => {
      console.log("|Main| new devices found checking them"), _();
    });
    return () => {
      I();
    };
  }, [i, l]);
  const G = async () => {
    const _ = await u.getDevices();
    if (y(J.keymap), _.length > 1) return console.log("|Main| more than one device connected, sending to choose device screeen"), n(de.chooseDevice, { state: _ }), true;
    if (_.length === 1) try {
      if (console.log("|Main| only one device connected, selecting it"), await f.selectAndConnectDevice(_[0].id)) return f.getConnectedDeviceInfo().then((A) => {
        A && S.sendDeviceSelectedEvent(A, i);
      }), t(), true;
    } catch (I) {
      console.warn("|Main| error while checking device error: " + I);
    }
    return false;
  }, X = (_) => {
    l && g(false), y(_);
  };
  return r.useEffect(() => {
    if (i !== o.completed && i != o.layout) {
      console.log("|Main| config in not completed cannot send data to device");
      return;
    }
    d == null ? void 0 : d.startUpdateDeviceConfig(C, T, m, F, x, j, E, R, M, K, c);
  }, [m, T, F, x, j, E, R, M, K, c]), e.jsx(Ye, { currentScreen: p, changeCurrentScreen: X, children: i === o.completed ? e.jsx(ze, { currentTab: p, changeTab: y }) : e.jsx(nn, { phase: i, handleDeviceConnected: t }) });
}
export {
  cn as default
};
