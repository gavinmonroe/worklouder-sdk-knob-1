import { a9 as Xe, r as v, s as Ye, n as Ve, aa as $e, y as qe, o as Je, B as Qe, E as et, h as me, j as C, X as G, ab as oe, G as U, ac as ge, ad as we, f as S, ae as tt, af as rt, ag as ot } from "./App-DDzLpl7E.js";
import { M as nt } from "./MainScaffold-D3RakiUq.js";
var ne = function(n, o) {
  return ne = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(e, t) {
    e.__proto__ = t;
  } || function(e, t) {
    for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (e[r] = t[r]);
  }, ne(n, o);
};
function it(n, o) {
  if (typeof o != "function" && o !== null) throw new TypeError("Class extends value " + String(o) + " is not a constructor or null");
  ne(n, o);
  function e() {
    this.constructor = n;
  }
  n.prototype = o === null ? Object.create(o) : (e.prototype = o.prototype, new e());
}
var _ = function() {
  return _ = Object.assign || function(o) {
    for (var e, t = 1, r = arguments.length; t < r; t++) {
      e = arguments[t];
      for (var i in e) Object.prototype.hasOwnProperty.call(e, i) && (o[i] = e[i]);
    }
    return o;
  }, _.apply(this, arguments);
};
var ye = false, W, ie, ae, $, q, Ee, J, se, ce, pe, ze, ue, le, Pe, Te;
function D() {
  if (!ye) {
    ye = true;
    var n = navigator.userAgent, o = /(?:MSIE.(\d+\.\d+))|(?:(?:Firefox|GranParadiso|Iceweasel).(\d+\.\d+))|(?:Opera(?:.+Version.|.)(\d+\.\d+))|(?:AppleWebKit.(\d+(?:\.\d+)?))|(?:Trident\/\d+\.\d+.*rv:(\d+\.\d+))/.exec(n), e = /(Mac OS X)|(Windows)|(Linux)/.exec(n);
    if (ue = /\b(iPhone|iP[ao]d)/.exec(n), le = /\b(iP[ao]d)/.exec(n), pe = /Android/i.exec(n), Pe = /FBAN\/\w+;/i.exec(n), Te = /Mobile/i.exec(n), ze = !!/Win64/.exec(n), o) {
      W = o[1] ? parseFloat(o[1]) : o[5] ? parseFloat(o[5]) : NaN, W && document && document.documentMode && (W = document.documentMode);
      var t = /(?:Trident\/(\d+.\d+))/.exec(n);
      Ee = t ? parseFloat(t[1]) + 4 : W, ie = o[2] ? parseFloat(o[2]) : NaN, ae = o[3] ? parseFloat(o[3]) : NaN, $ = o[4] ? parseFloat(o[4]) : NaN, $ ? (o = /(?:Chrome\/(\d+\.\d+))/.exec(n), q = o && o[1] ? parseFloat(o[1]) : NaN) : q = NaN;
    } else W = ie = ae = q = $ = NaN;
    if (e) {
      if (e[1]) {
        var r = /(?:Mac OS X (\d+(?:[._]\d+)?))/.exec(n);
        J = r ? parseFloat(r[1].replace("_", ".")) : true;
      } else J = false;
      se = !!e[2], ce = !!e[3];
    } else J = se = ce = false;
  }
}
var he = { ie: function() {
  return D() || W;
}, ieCompatibilityMode: function() {
  return D() || Ee > W;
}, ie64: function() {
  return he.ie() && ze;
}, firefox: function() {
  return D() || ie;
}, opera: function() {
  return D() || ae;
}, webkit: function() {
  return D() || $;
}, safari: function() {
  return he.webkit();
}, chrome: function() {
  return D() || q;
}, windows: function() {
  return D() || se;
}, osx: function() {
  return D() || J;
}, linux: function() {
  return D() || ce;
}, iphone: function() {
  return D() || ue;
}, mobile: function() {
  return D() || ue || le || pe || Te;
}, nativeApp: function() {
  return D() || Pe;
}, android: function() {
  return D() || pe;
}, ipad: function() {
  return D() || le;
} }, at = he, st = !!(typeof window < "u" && window.document && window.document.createElement), ct = { canUseDOM: st }, pt = ct, Me = pt, Fe;
Me.canUseDOM && (Fe = document.implementation && document.implementation.hasFeature && document.implementation.hasFeature("", "") !== true);
/**
* Checks if an event is supported in the current execution environment.
*
* NOTE: This will not work correctly for non-generic events such as `change`,
* `reset`, `load`, `error`, and `select`.
*
* Borrows from Modernizr.
*
* @param {string} eventNameSuffix Event name, e.g. "click".
* @param {?boolean} capture Check if the capture phase is supported.
* @return {boolean} True if the event is supported.
* @internal
* @license Modernizr 3.0.0pre (Custom Build) | MIT
*/
function ut(n, o) {
  if (!Me.canUseDOM || o && !("addEventListener" in document)) return false;
  var e = "on" + n, t = e in document;
  if (!t) {
    var r = document.createElement("div");
    r.setAttribute(e, "return;"), t = typeof r[e] == "function";
  }
  return !t && Fe && n === "wheel" && (t = document.implementation.hasFeature("Events.wheel", "3.0")), t;
}
var lt = ut, ht = at, dt = lt, Ce = 10, _e = 40, xe = 800;
function Ae(n) {
  var o = 0, e = 0, t = 0, r = 0;
  return "detail" in n && (e = n.detail), "wheelDelta" in n && (e = -n.wheelDelta / 120), "wheelDeltaY" in n && (e = -n.wheelDeltaY / 120), "wheelDeltaX" in n && (o = -n.wheelDeltaX / 120), "axis" in n && n.axis === n.HORIZONTAL_AXIS && (o = e, e = 0), t = o * Ce, r = e * Ce, "deltaY" in n && (r = n.deltaY), "deltaX" in n && (t = n.deltaX), (t || r) && n.deltaMode && (n.deltaMode == 1 ? (t *= _e, r *= _e) : (t *= xe, r *= xe)), t && !o && (o = t < 1 ? -1 : 1), r && !e && (e = r < 1 ? -1 : 1), { spinX: o, spinY: e, pixelX: t, pixelY: r };
}
Ae.getEventType = function() {
  return ht.firefox() ? "DOMMouseScroll" : dt("wheel") ? "wheel" : "mousewheel";
};
var ft = Ae, vt = ft;
const mt = Xe(vt);
function gt(n, o, e, t, r, i) {
  i === void 0 && (i = 0);
  var s = L(n, o, i), a = s.width, c = s.height, p = Math.min(a, e), u = Math.min(c, t);
  return p > u * r ? { width: u * r, height: u } : { width: p, height: p / r };
}
function wt(n) {
  return n.width > n.height ? n.width / n.naturalWidth : n.height / n.naturalHeight;
}
function B(n, o, e, t, r) {
  r === void 0 && (r = 0);
  var i = L(o.width, o.height, r), s = i.width, a = i.height;
  return { x: Se(n.x, s, e.width, t), y: Se(n.y, a, e.height, t) };
}
function Se(n, o, e, t) {
  var r = o * t / 2 - e / 2;
  return Q(n, -r, r);
}
function be(n, o) {
  return Math.sqrt(Math.pow(n.y - o.y, 2) + Math.pow(n.x - o.x, 2));
}
function Re(n, o) {
  return Math.atan2(o.y - n.y, o.x - n.x) * 180 / Math.PI;
}
function yt(n, o, e, t, r, i, s) {
  i === void 0 && (i = 0), s === void 0 && (s = true);
  var a = s ? Ct : _t, c = L(o.width, o.height, i), p = L(o.naturalWidth, o.naturalHeight, i), u = { x: a(100, ((c.width - e.width / r) / 2 - n.x / r) / c.width * 100), y: a(100, ((c.height - e.height / r) / 2 - n.y / r) / c.height * 100), width: a(100, e.width / c.width * 100 / r), height: a(100, e.height / c.height * 100 / r) }, m = Math.round(a(p.width, u.width * p.width / 100)), d = Math.round(a(p.height, u.height * p.height / 100)), w = p.width >= p.height * t, y = w ? { width: Math.round(d * t), height: d } : { width: m, height: Math.round(m / t) }, g = _(_({}, y), { x: Math.round(a(p.width - y.width, u.x * p.width / 100)), y: Math.round(a(p.height - y.height, u.y * p.height / 100)) });
  return { croppedAreaPercentages: u, croppedAreaPixels: g };
}
function Ct(n, o) {
  return Math.min(n, Math.max(0, o));
}
function _t(n, o) {
  return o;
}
function xt(n, o, e, t, r, i) {
  var s = L(o.width, o.height, e), a = Q(t.width / s.width * (100 / n.width), r, i), c = { x: a * s.width / 2 - t.width / 2 - s.width * a * (n.x / 100), y: a * s.height / 2 - t.height / 2 - s.height * a * (n.y / 100) };
  return { crop: c, zoom: a };
}
function St(n, o, e) {
  var t = wt(o);
  return e.height > e.width ? e.height / (n.height * t) : e.width / (n.width * t);
}
function bt(n, o, e, t, r, i) {
  e === void 0 && (e = 0);
  var s = L(o.naturalWidth, o.naturalHeight, e), a = Q(St(n, o, t), r, i), c = t.height > t.width ? t.height / n.height : t.width / n.width, p = { x: ((s.width - n.width) / 2 - n.x) * c, y: ((s.height - n.height) / 2 - n.y) * c };
  return { crop: p, zoom: a };
}
function De(n, o) {
  return { x: (o.x + n.x) / 2, y: (o.y + n.y) / 2 };
}
function Rt(n) {
  return n * Math.PI / 180;
}
function L(n, o, e) {
  var t = Rt(e);
  return { width: Math.abs(Math.cos(t) * n) + Math.abs(Math.sin(t) * o), height: Math.abs(Math.sin(t) * n) + Math.abs(Math.cos(t) * o) };
}
function Q(n, o, e) {
  return Math.min(Math.max(n, o), e);
}
function V() {
  for (var n = [], o = 0; o < arguments.length; o++) n[o] = arguments[o];
  return n.filter(function(e) {
    return typeof e == "string" && e.length > 0;
  }).join(" ").trim();
}
var Dt = `.reactEasyCrop_Container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  user-select: none;
  touch-action: none;
  cursor: move;
  display: flex;
  justify-content: center;
  align-items: center;
}

.reactEasyCrop_Image,
.reactEasyCrop_Video {
  will-change: transform; /* this improves performances and prevent painting issues on iOS Chrome */
}

.reactEasyCrop_Contain {
  max-width: 100%;
  max-height: 100%;
  margin: auto;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
}
.reactEasyCrop_Cover_Horizontal {
  width: 100%;
  height: auto;
}
.reactEasyCrop_Cover_Vertical {
  width: auto;
  height: 100%;
}

.reactEasyCrop_CropArea {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-sizing: border-box;
  box-shadow: 0 0 0 9999em;
  color: rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.reactEasyCrop_CropAreaRound {
  border-radius: 50%;
}

.reactEasyCrop_CropAreaGrid::before {
  content: ' ';
  box-sizing: border-box;
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.5);
  top: 0;
  bottom: 0;
  left: 33.33%;
  right: 33.33%;
  border-top: 0;
  border-bottom: 0;
}

.reactEasyCrop_CropAreaGrid::after {
  content: ' ';
  box-sizing: border-box;
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.5);
  top: 33.33%;
  bottom: 33.33%;
  left: 0;
  right: 0;
  border-left: 0;
  border-right: 0;
}
`, Et = 1, zt = 3, Pt = 1, Tt = function(n) {
  it(o, n);
  function o() {
    var e = n !== null && n.apply(this, arguments) || this;
    return e.cropperRef = v.createRef(), e.imageRef = v.createRef(), e.videoRef = v.createRef(), e.containerPosition = { x: 0, y: 0 }, e.containerRef = null, e.styleRef = null, e.containerRect = null, e.mediaSize = { width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 }, e.dragStartPosition = { x: 0, y: 0 }, e.dragStartCrop = { x: 0, y: 0 }, e.gestureZoomStart = 0, e.gestureRotationStart = 0, e.isTouching = false, e.lastPinchDistance = 0, e.lastPinchRotation = 0, e.rafDragTimeout = null, e.rafPinchTimeout = null, e.wheelTimer = null, e.currentDoc = typeof document < "u" ? document : null, e.currentWindow = typeof window < "u" ? window : null, e.resizeObserver = null, e.previousCropSize = null, e.isInitialized = false, e.state = { cropSize: null, hasWheelJustStarted: false, mediaObjectFit: void 0 }, e.initResizeObserver = function() {
      if (!(typeof window.ResizeObserver > "u" || !e.containerRef)) {
        var t = true;
        e.resizeObserver = new window.ResizeObserver(function(r) {
          if (t) {
            t = false;
            return;
          }
          e.computeSizes();
        }), e.resizeObserver.observe(e.containerRef);
      }
    }, e.preventZoomSafari = function(t) {
      return t.preventDefault();
    }, e.cleanEvents = function() {
      e.currentDoc && (e.currentDoc.removeEventListener("mousemove", e.onMouseMove), e.currentDoc.removeEventListener("mouseup", e.onDragStopped), e.currentDoc.removeEventListener("touchmove", e.onTouchMove), e.currentDoc.removeEventListener("touchend", e.onDragStopped), e.currentDoc.removeEventListener("gesturechange", e.onGestureChange), e.currentDoc.removeEventListener("gestureend", e.onGestureEnd), e.currentDoc.removeEventListener("scroll", e.onScroll));
    }, e.clearScrollEvent = function() {
      e.containerRef && e.containerRef.removeEventListener("wheel", e.onWheel), e.wheelTimer && clearTimeout(e.wheelTimer);
    }, e.onMediaLoad = function() {
      var t = e.computeSizes();
      t && (e.previousCropSize = t, e.emitCropData(), e.setInitialCrop(t), e.isInitialized = true), e.props.onMediaLoaded && e.props.onMediaLoaded(e.mediaSize);
    }, e.setInitialCrop = function(t) {
      if (e.props.initialCroppedAreaPercentages) {
        var r = xt(e.props.initialCroppedAreaPercentages, e.mediaSize, e.props.rotation, t, e.props.minZoom, e.props.maxZoom), i = r.crop, s = r.zoom;
        e.props.onCropChange(i), e.props.onZoomChange && e.props.onZoomChange(s);
      } else if (e.props.initialCroppedAreaPixels) {
        var a = bt(e.props.initialCroppedAreaPixels, e.mediaSize, e.props.rotation, t, e.props.minZoom, e.props.maxZoom), i = a.crop, s = a.zoom;
        e.props.onCropChange(i), e.props.onZoomChange && e.props.onZoomChange(s);
      }
    }, e.computeSizes = function() {
      var t, r, i, s, a, c, p = e.imageRef.current || e.videoRef.current;
      if (p && e.containerRef) {
        e.containerRect = e.containerRef.getBoundingClientRect(), e.saveContainerPosition();
        var u = e.containerRect.width / e.containerRect.height, m = ((t = e.imageRef.current) === null || t === void 0 ? void 0 : t.naturalWidth) || ((r = e.videoRef.current) === null || r === void 0 ? void 0 : r.videoWidth) || 0, d = ((i = e.imageRef.current) === null || i === void 0 ? void 0 : i.naturalHeight) || ((s = e.videoRef.current) === null || s === void 0 ? void 0 : s.videoHeight) || 0, w = p.offsetWidth < m || p.offsetHeight < d, y = m / d, g = void 0;
        if (w) switch (e.state.mediaObjectFit) {
          default:
          case "contain":
            g = u > y ? { width: e.containerRect.height * y, height: e.containerRect.height } : { width: e.containerRect.width, height: e.containerRect.width / y };
            break;
          case "horizontal-cover":
            g = { width: e.containerRect.width, height: e.containerRect.width / y };
            break;
          case "vertical-cover":
            g = { width: e.containerRect.height * y, height: e.containerRect.height };
            break;
        }
        else g = { width: p.offsetWidth, height: p.offsetHeight };
        e.mediaSize = _(_({}, g), { naturalWidth: m, naturalHeight: d }), e.props.setMediaSize && e.props.setMediaSize(e.mediaSize);
        var b = e.props.cropSize ? e.props.cropSize : gt(e.mediaSize.width, e.mediaSize.height, e.containerRect.width, e.containerRect.height, e.props.aspect, e.props.rotation);
        return (((a = e.state.cropSize) === null || a === void 0 ? void 0 : a.height) !== b.height || ((c = e.state.cropSize) === null || c === void 0 ? void 0 : c.width) !== b.width) && e.props.onCropSizeChange && e.props.onCropSizeChange(b), e.setState({ cropSize: b }, e.recomputeCropPosition), e.props.setCropSize && e.props.setCropSize(b), b;
      }
    }, e.saveContainerPosition = function() {
      if (e.containerRef) {
        var t = e.containerRef.getBoundingClientRect();
        e.containerPosition = { x: t.left, y: t.top };
      }
    }, e.onMouseDown = function(t) {
      e.currentDoc && (t.preventDefault(), e.currentDoc.addEventListener("mousemove", e.onMouseMove), e.currentDoc.addEventListener("mouseup", e.onDragStopped), e.saveContainerPosition(), e.onDragStart(o.getMousePoint(t)));
    }, e.onMouseMove = function(t) {
      return e.onDrag(o.getMousePoint(t));
    }, e.onScroll = function(t) {
      e.currentDoc && (t.preventDefault(), e.saveContainerPosition());
    }, e.onTouchStart = function(t) {
      e.currentDoc && (e.isTouching = true, !(e.props.onTouchRequest && !e.props.onTouchRequest(t)) && (e.currentDoc.addEventListener("touchmove", e.onTouchMove, { passive: false }), e.currentDoc.addEventListener("touchend", e.onDragStopped), e.saveContainerPosition(), t.touches.length === 2 ? e.onPinchStart(t) : t.touches.length === 1 && e.onDragStart(o.getTouchPoint(t.touches[0]))));
    }, e.onTouchMove = function(t) {
      t.preventDefault(), t.touches.length === 2 ? e.onPinchMove(t) : t.touches.length === 1 && e.onDrag(o.getTouchPoint(t.touches[0]));
    }, e.onGestureStart = function(t) {
      e.currentDoc && (t.preventDefault(), e.currentDoc.addEventListener("gesturechange", e.onGestureChange), e.currentDoc.addEventListener("gestureend", e.onGestureEnd), e.gestureZoomStart = e.props.zoom, e.gestureRotationStart = e.props.rotation);
    }, e.onGestureChange = function(t) {
      if (t.preventDefault(), !e.isTouching) {
        var r = o.getMousePoint(t), i = e.gestureZoomStart - 1 + t.scale;
        if (e.setNewZoom(i, r, { shouldUpdatePosition: true }), e.props.onRotationChange) {
          var s = e.gestureRotationStart + t.rotation;
          e.props.onRotationChange(s);
        }
      }
    }, e.onGestureEnd = function(t) {
      e.cleanEvents();
    }, e.onDragStart = function(t) {
      var r, i, s = t.x, a = t.y;
      e.dragStartPosition = { x: s, y: a }, e.dragStartCrop = _({}, e.props.crop), (i = (r = e.props).onInteractionStart) === null || i === void 0 || i.call(r);
    }, e.onDrag = function(t) {
      var r = t.x, i = t.y;
      e.currentWindow && (e.rafDragTimeout && e.currentWindow.cancelAnimationFrame(e.rafDragTimeout), e.rafDragTimeout = e.currentWindow.requestAnimationFrame(function() {
        if (e.state.cropSize && !(r === void 0 || i === void 0)) {
          var s = r - e.dragStartPosition.x, a = i - e.dragStartPosition.y, c = { x: e.dragStartCrop.x + s, y: e.dragStartCrop.y + a }, p = e.props.restrictPosition ? B(c, e.mediaSize, e.state.cropSize, e.props.zoom, e.props.rotation) : c;
          e.props.onCropChange(p);
        }
      }));
    }, e.onDragStopped = function() {
      var t, r;
      e.isTouching = false, e.cleanEvents(), e.emitCropData(), (r = (t = e.props).onInteractionEnd) === null || r === void 0 || r.call(t);
    }, e.onWheel = function(t) {
      if (e.currentWindow && !(e.props.onWheelRequest && !e.props.onWheelRequest(t))) {
        t.preventDefault();
        var r = o.getMousePoint(t), i = mt(t).pixelY, s = e.props.zoom - i * e.props.zoomSpeed / 200;
        e.setNewZoom(s, r, { shouldUpdatePosition: true }), e.state.hasWheelJustStarted || e.setState({ hasWheelJustStarted: true }, function() {
          var a, c;
          return (c = (a = e.props).onInteractionStart) === null || c === void 0 ? void 0 : c.call(a);
        }), e.wheelTimer && clearTimeout(e.wheelTimer), e.wheelTimer = e.currentWindow.setTimeout(function() {
          return e.setState({ hasWheelJustStarted: false }, function() {
            var a, c;
            return (c = (a = e.props).onInteractionEnd) === null || c === void 0 ? void 0 : c.call(a);
          });
        }, 250);
      }
    }, e.getPointOnContainer = function(t, r) {
      var i = t.x, s = t.y;
      if (!e.containerRect) throw new Error("The Cropper is not mounted");
      return { x: e.containerRect.width / 2 - (i - r.x), y: e.containerRect.height / 2 - (s - r.y) };
    }, e.getPointOnMedia = function(t) {
      var r = t.x, i = t.y, s = e.props, a = s.crop, c = s.zoom;
      return { x: (r + a.x) / c, y: (i + a.y) / c };
    }, e.setNewZoom = function(t, r, i) {
      var s = i === void 0 ? {} : i, a = s.shouldUpdatePosition, c = a === void 0 ? true : a;
      if (!(!e.state.cropSize || !e.props.onZoomChange)) {
        var p = Q(t, e.props.minZoom, e.props.maxZoom);
        if (c) {
          var u = e.getPointOnContainer(r, e.containerPosition), m = e.getPointOnMedia(u), d = { x: m.x * p - u.x, y: m.y * p - u.y }, w = e.props.restrictPosition ? B(d, e.mediaSize, e.state.cropSize, p, e.props.rotation) : d;
          e.props.onCropChange(w);
        }
        e.props.onZoomChange(p);
      }
    }, e.getCropData = function() {
      if (!e.state.cropSize) return null;
      var t = e.props.restrictPosition ? B(e.props.crop, e.mediaSize, e.state.cropSize, e.props.zoom, e.props.rotation) : e.props.crop;
      return yt(t, e.mediaSize, e.state.cropSize, e.getAspect(), e.props.zoom, e.props.rotation, e.props.restrictPosition);
    }, e.emitCropData = function() {
      var t = e.getCropData();
      if (t) {
        var r = t.croppedAreaPercentages, i = t.croppedAreaPixels;
        e.props.onCropComplete && e.props.onCropComplete(r, i), e.props.onCropAreaChange && e.props.onCropAreaChange(r, i);
      }
    }, e.emitCropAreaChange = function() {
      var t = e.getCropData();
      if (t) {
        var r = t.croppedAreaPercentages, i = t.croppedAreaPixels;
        e.props.onCropAreaChange && e.props.onCropAreaChange(r, i);
      }
    }, e.recomputeCropPosition = function() {
      var t, r;
      if (e.state.cropSize) {
        var i = e.props.crop;
        if (e.isInitialized && (!((t = e.previousCropSize) === null || t === void 0) && t.width) && (!((r = e.previousCropSize) === null || r === void 0) && r.height)) {
          var s = Math.abs(e.previousCropSize.width - e.state.cropSize.width) > 1e-6 || Math.abs(e.previousCropSize.height - e.state.cropSize.height) > 1e-6;
          if (s) {
            var a = e.state.cropSize.width / e.previousCropSize.width, c = e.state.cropSize.height / e.previousCropSize.height;
            i = { x: e.props.crop.x * a, y: e.props.crop.y * c };
          }
        }
        var p = e.props.restrictPosition ? B(i, e.mediaSize, e.state.cropSize, e.props.zoom, e.props.rotation) : i;
        e.previousCropSize = e.state.cropSize, e.props.onCropChange(p), e.emitCropData();
      }
    }, e.onKeyDown = function(t) {
      var r, i, s = e.props, a = s.crop, c = s.onCropChange, p = s.keyboardStep, u = s.zoom, m = s.rotation, d = p;
      if (e.state.cropSize) {
        t.shiftKey && (d *= 0.2);
        var w = _({}, a);
        switch (t.key) {
          case "ArrowUp":
            w.y -= d, t.preventDefault();
            break;
          case "ArrowDown":
            w.y += d, t.preventDefault();
            break;
          case "ArrowLeft":
            w.x -= d, t.preventDefault();
            break;
          case "ArrowRight":
            w.x += d, t.preventDefault();
            break;
          default:
            return;
        }
        e.props.restrictPosition && (w = B(w, e.mediaSize, e.state.cropSize, u, m)), t.repeat || (i = (r = e.props).onInteractionStart) === null || i === void 0 || i.call(r), c(w);
      }
    }, e.onKeyUp = function(t) {
      var r, i;
      switch (t.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight":
          t.preventDefault();
          break;
        default:
          return;
      }
      e.emitCropData(), (i = (r = e.props).onInteractionEnd) === null || i === void 0 || i.call(r);
    }, e;
  }
  return o.prototype.componentDidMount = function() {
    !this.currentDoc || !this.currentWindow || (this.containerRef && (this.containerRef.ownerDocument && (this.currentDoc = this.containerRef.ownerDocument), this.currentDoc.defaultView && (this.currentWindow = this.currentDoc.defaultView), this.initResizeObserver(), typeof window.ResizeObserver > "u" && this.currentWindow.addEventListener("resize", this.computeSizes), this.props.zoomWithScroll && this.containerRef.addEventListener("wheel", this.onWheel, { passive: false }), this.containerRef.addEventListener("gesturestart", this.onGestureStart)), this.currentDoc.addEventListener("scroll", this.onScroll), this.props.disableAutomaticStylesInjection || (this.styleRef = this.currentDoc.createElement("style"), this.styleRef.setAttribute("type", "text/css"), this.props.nonce && this.styleRef.setAttribute("nonce", this.props.nonce), this.styleRef.innerHTML = Dt, this.currentDoc.head.appendChild(this.styleRef)), this.imageRef.current && this.imageRef.current.complete && this.onMediaLoad(), this.props.setImageRef && this.props.setImageRef(this.imageRef), this.props.setVideoRef && this.props.setVideoRef(this.videoRef), this.props.setCropperRef && this.props.setCropperRef(this.cropperRef));
  }, o.prototype.componentWillUnmount = function() {
    var e, t;
    !this.currentDoc || !this.currentWindow || (typeof window.ResizeObserver > "u" && this.currentWindow.removeEventListener("resize", this.computeSizes), (e = this.resizeObserver) === null || e === void 0 || e.disconnect(), this.containerRef && this.containerRef.removeEventListener("gesturestart", this.preventZoomSafari), this.styleRef && ((t = this.styleRef.parentNode) === null || t === void 0 || t.removeChild(this.styleRef)), this.cleanEvents(), this.props.zoomWithScroll && this.clearScrollEvent());
  }, o.prototype.componentDidUpdate = function(e) {
    var t, r, i, s, a, c, p, u, m;
    e.rotation !== this.props.rotation ? (this.computeSizes(), this.recomputeCropPosition()) : e.aspect !== this.props.aspect ? this.computeSizes() : e.objectFit !== this.props.objectFit ? this.computeSizes() : e.zoom !== this.props.zoom ? this.recomputeCropPosition() : ((t = e.cropSize) === null || t === void 0 ? void 0 : t.height) !== ((r = this.props.cropSize) === null || r === void 0 ? void 0 : r.height) || ((i = e.cropSize) === null || i === void 0 ? void 0 : i.width) !== ((s = this.props.cropSize) === null || s === void 0 ? void 0 : s.width) ? this.computeSizes() : (((a = e.crop) === null || a === void 0 ? void 0 : a.x) !== ((c = this.props.crop) === null || c === void 0 ? void 0 : c.x) || ((p = e.crop) === null || p === void 0 ? void 0 : p.y) !== ((u = this.props.crop) === null || u === void 0 ? void 0 : u.y)) && this.emitCropAreaChange(), e.zoomWithScroll !== this.props.zoomWithScroll && this.containerRef && (this.props.zoomWithScroll ? this.containerRef.addEventListener("wheel", this.onWheel, { passive: false }) : this.clearScrollEvent()), e.video !== this.props.video && ((m = this.videoRef.current) === null || m === void 0 || m.load());
    var d = this.getObjectFit();
    d !== this.state.mediaObjectFit && this.setState({ mediaObjectFit: d }, this.computeSizes);
  }, o.prototype.getAspect = function() {
    var e = this.props, t = e.cropSize, r = e.aspect;
    return t ? t.width / t.height : r;
  }, o.prototype.getObjectFit = function() {
    var e, t, r, i;
    if (this.props.objectFit === "cover") {
      var s = this.imageRef.current || this.videoRef.current;
      if (s && this.containerRef) {
        this.containerRect = this.containerRef.getBoundingClientRect();
        var a = this.containerRect.width / this.containerRect.height, c = ((e = this.imageRef.current) === null || e === void 0 ? void 0 : e.naturalWidth) || ((t = this.videoRef.current) === null || t === void 0 ? void 0 : t.videoWidth) || 0, p = ((r = this.imageRef.current) === null || r === void 0 ? void 0 : r.naturalHeight) || ((i = this.videoRef.current) === null || i === void 0 ? void 0 : i.videoHeight) || 0, u = c / p;
        return u < a ? "horizontal-cover" : "vertical-cover";
      }
      return "horizontal-cover";
    }
    return this.props.objectFit;
  }, o.prototype.onPinchStart = function(e) {
    var t = o.getTouchPoint(e.touches[0]), r = o.getTouchPoint(e.touches[1]);
    this.lastPinchDistance = be(t, r), this.lastPinchRotation = Re(t, r), this.onDragStart(De(t, r));
  }, o.prototype.onPinchMove = function(e) {
    var t = this;
    if (!(!this.currentDoc || !this.currentWindow)) {
      var r = o.getTouchPoint(e.touches[0]), i = o.getTouchPoint(e.touches[1]), s = De(r, i);
      this.onDrag(s), this.rafPinchTimeout && this.currentWindow.cancelAnimationFrame(this.rafPinchTimeout), this.rafPinchTimeout = this.currentWindow.requestAnimationFrame(function() {
        var a = be(r, i), c = t.props.zoom * (a / t.lastPinchDistance);
        t.setNewZoom(c, s, { shouldUpdatePosition: false }), t.lastPinchDistance = a;
        var p = Re(r, i), u = t.props.rotation + (p - t.lastPinchRotation);
        t.props.onRotationChange && t.props.onRotationChange(u), t.lastPinchRotation = p;
      });
    }
  }, o.prototype.render = function() {
    var e = this, t, r = this.props, i = r.image, s = r.video, a = r.mediaProps, c = r.cropperProps, p = r.transform, u = r.crop, m = u.x, d = u.y, w = r.rotation, y = r.zoom, g = r.cropShape, b = r.showGrid, K = r.roundCropAreaPixels, j = r.style, ee = j.containerStyle, H = j.cropAreaStyle, X = j.mediaStyle, I = r.classes, te = I.containerClassName, O = I.cropAreaClassName, Y = I.mediaClassName, T = (t = this.state.mediaObjectFit) !== null && t !== void 0 ? t : this.getObjectFit();
    return v.createElement("div", { onMouseDown: this.onMouseDown, onTouchStart: this.onTouchStart, ref: function(E) {
      return e.containerRef = E;
    }, "data-testid": "container", style: ee, className: V("reactEasyCrop_Container", te) }, i ? v.createElement("img", _({ alt: "", className: V("reactEasyCrop_Image", T === "contain" && "reactEasyCrop_Contain", T === "horizontal-cover" && "reactEasyCrop_Cover_Horizontal", T === "vertical-cover" && "reactEasyCrop_Cover_Vertical", Y) }, a, { src: i, ref: this.imageRef, style: _(_({}, X), { transform: p || "translate(".concat(m, "px, ").concat(d, "px) rotate(").concat(w, "deg) scale(").concat(y, ")") }), onLoad: this.onMediaLoad })) : s && v.createElement("video", _({ autoPlay: true, playsInline: true, loop: true, muted: true, className: V("reactEasyCrop_Video", T === "contain" && "reactEasyCrop_Contain", T === "horizontal-cover" && "reactEasyCrop_Cover_Horizontal", T === "vertical-cover" && "reactEasyCrop_Cover_Vertical", Y) }, a, { ref: this.videoRef, onLoadedMetadata: this.onMediaLoad, style: _(_({}, X), { transform: p || "translate(".concat(m, "px, ").concat(d, "px) rotate(").concat(w, "deg) scale(").concat(y, ")") }), controls: false }), (Array.isArray(s) ? s : [{ src: s }]).map(function(N) {
      return v.createElement("source", _({ key: N.src }, N));
    })), this.state.cropSize && v.createElement("div", _({ ref: this.cropperRef, style: _(_({}, H), { width: K ? Math.round(this.state.cropSize.width) : this.state.cropSize.width, height: K ? Math.round(this.state.cropSize.height) : this.state.cropSize.height }), tabIndex: 0, onKeyDown: this.onKeyDown, onKeyUp: this.onKeyUp, "data-testid": "cropper", className: V("reactEasyCrop_CropArea", g === "round" && "reactEasyCrop_CropAreaRound", b && "reactEasyCrop_CropAreaGrid", O) }, c)));
  }, o.defaultProps = { zoom: 1, rotation: 0, aspect: 4 / 3, maxZoom: zt, minZoom: Et, cropShape: "rect", objectFit: "contain", showGrid: true, style: {}, classes: {}, mediaProps: {}, cropperProps: {}, zoomSpeed: 1, restrictPosition: true, zoomWithScroll: true, keyboardStep: Pt }, o.getMousePoint = function(e) {
    return { x: Number(e.clientX), y: Number(e.clientY) };
  }, o.getTouchPoint = function(e) {
    return { x: Number(e.clientX), y: Number(e.clientY) };
  }, o;
}(v.Component);
const Mt = "_main_column_3xvsf_1", Ft = "_wallpaper_image_3xvsf_9", At = "_crop_image_3xvsf_16", Nt = "_select_image_stack_3xvsf_23", Wt = "_choose_image_overlay_button_3xvsf_30", jt = "_wallpaper_message_3xvsf_36", It = "_actions_column_3xvsf_43", A = { main_column: Mt, wallpaper_image: Ft, crop_image: At, select_image_stack: Nt, choose_image_overlay_button: Wt, wallpaper_message: jt, actions_column: It };
function kt() {
  const n = Ye(), o = Ve(), e = $e(), t = qe(), r = Je(), [i, s] = v.useState(void 0), a = v.useRef(null), [c, p] = v.useState(), [u, m] = v.useState({ x: 0, y: 0 }), [d, w] = v.useState(1), [y, g] = v.useState(0), [b, K] = v.useState(null), [j, ee] = v.useState(null), [H, X] = v.useState(void 0), [I, te] = v.useState(void 0), [O, Y] = v.useState(void 0), [T, N] = v.useState(void 0), E = Qe(et), re = me.deviceHasNewGifFlow(E);
  v.useEffect(() => {
    Ne();
    const l = setInterval(async () => {
      if (await o.isConnected() === false) {
        n(U.main, { state: { tab: G.keymap } });
        return;
      }
    }, 1e3);
    return () => {
      clearInterval(l);
    };
  }, []);
  const Ne = async () => {
    const h = await (e == null ? void 0 : e.getWallpaper());
    if (h !== void 0) {
      const l = h.data.buffer.slice(h.data.byteOffset, h.data.byteOffset + h.data.byteLength), x = new Blob([l], { type: h.mimeType }), f = URL.createObjectURL(x);
      s(f);
    }
  }, We = (h) => {
    w(h);
  }, je = (h, l) => {
    K(l);
  }, Ie = () => {
    var _a;
    y !== 1 && (a.current && (a.current.value = ""), (_a = a == null ? void 0 : a.current) == null ? void 0 : _a.click());
  }, Oe = async (h, l, x, f) => {
    const z = document.createElement("canvas"), M = z.getContext("2d");
    if (!M) return;
    z.width = l.width, z.height = l.height, M.drawImage(h, l.x, l.y, l.width, l.height, 0, 0, l.width, l.height);
    const F = document.createElement("canvas"), R = F.getContext("2d"), P = 12;
    return F.width = x, F.height = f, R == null ? void 0 : R.beginPath(), R == null ? void 0 : R.moveTo(P, 0), R == null ? void 0 : R.arcTo(x, 0, x, f, P), R == null ? void 0 : R.arcTo(x, f, 0, f, P), R == null ? void 0 : R.arcTo(0, f, 0, 0, P), R == null ? void 0 : R.arcTo(0, 0, x, 0, P), R == null ? void 0 : R.closePath(), R == null ? void 0 : R.clip(), R == null ? void 0 : R.drawImage(z, 0, 0, Z(), k()), new Promise((He, Ot) => {
      F.toBlob((ve) => (ve != null && He(ve.arrayBuffer()), null));
    });
  }, de = async (h, l) => {
    let x = 2;
    try {
      let f;
      for ((E.deviceType === S.DeviceType.Knob || E.deviceType === S.DeviceType.KnobF1) && (f = (await imageChannel.getAccentColorFromImage(h)).replace("#", "")); x > 0; ) {
        if (await (e == null ? void 0 : e.addNewWallpaper(h, l, f))) return true;
        x -= 1;
      }
      return false;
    } catch (f) {
      return console.log(f), false;
    }
  }, Le = async () => {
    if (y == 1 || j === null || b === null) return;
    if (g(1), I === "image/gif" && H) {
      if (!re) {
        g(2);
        return;
      }
      const f = await imageChannel.cropGifImage(H, b.x, b.y, b.width, b.height, Z(), k(), O);
      if (!f) {
        g(2);
        return;
      }
      if (!await de(f, ge.gif)) {
        g(2);
        return;
      }
      await r.getDeviceConfigAsync(E), g(0), t.sendAddWallpaperEvent(!i), n(U.main, { state: { tab: G.widgets } });
      return;
    }
    const h = await Oe(j, b, Z(), k());
    if (h == null) {
      g(2);
      return;
    }
    const l = new Uint8Array(h);
    if (!await de(l, ge.static)) {
      g(2);
      return;
    }
    await r.getDeviceConfigAsync(E), g(0), t.sendAddWallpaperEvent(!i), n(U.main, { state: { tab: G.widgets } });
  }, fe = async (h, l, x) => {
    const f = await new Promise((z, M) => {
      const F = new FileReader();
      F.onload = (R) => {
        if (R.target === null || R.target.result === null) {
          M(new Error("Image is null"));
          return;
        }
        const P = new Image();
        P.onload = () => z({ src: R.target.result, image: P }), P.onerror = () => M(new Error("Cannot decode image")), P.src = R.target.result;
      }, F.onerror = () => M(F.error ?? new Error("Cannot read image")), F.readAsDataURL(h);
    });
    te(we(h) ? "image/gif" : h.type), X(l), ee(f.image), p(f.src), Y(x), N(void 0), g(0);
  }, Ze = async (h) => {
    var _a;
    try {
      const l = (_a = h.target.files) == null ? void 0 : _a[0];
      if (!l) throw new Error("No file selected");
      N(void 0), g(0);
      const x = we(l);
      if (x && !re) throw new Error("GIF wallpapers are not supported by this device");
      const f = await l.arrayBuffer();
      if (x) {
        const z = me.getMaxGifFrameCount(E.deviceType), M = await imageChannel.getGifFrameCount(f);
        if (z === void 0 || M === void 0) throw new Error("Could not inspect the selected GIF");
        await fe(l, f, M > z ? z : void 0);
        return;
      }
      await fe(l, f);
    } catch (l) {
      console.log("cannot open image" + l), N(l instanceof Error ? l.message : "Could not open the selected image"), a.current && (a.current.value = "");
    }
  }, ke = () => {
    y !== 1 && n(U.main, { state: { tab: G.widgets } });
  }, Ge = (h) => {
    n(U.main, { state: { tab: h } });
  }, Ue = (h) => {
    switch (h) {
      case S.DeviceType.KnobF1:
        return "uploading wallpaper on your Framer F1";
      case S.DeviceType.Knob:
        return "uploading wallpaper on your Knob1";
      default:
        return "uploading wallpaper on your NomadE";
    }
  }, Be = () => {
    switch (y) {
      case 0:
        return O === void 0 ? "Save & Exit" : `Upload first ${O} frames`;
      case 1:
        return Ue(E.deviceType);
      case 2:
        return "There has been an error, please retry";
      default:
        return "Save & Exit";
    }
  }, Z = () => {
    switch (E.deviceType) {
      case S.DeviceType.NomadE:
      case S.DeviceType.NomadEV2:
        return 170;
      case S.DeviceType.Knob:
      case S.DeviceType.KnobF1:
        return 100;
      default:
        return 170;
    }
  }, k = () => {
    switch (E.deviceType) {
      case S.DeviceType.NomadE:
      case S.DeviceType.NomadEV2:
        return 320;
      case S.DeviceType.Knob:
      case S.DeviceType.KnobF1:
        return 310;
      default:
        return 320;
    }
  }, Ke = () => {
    switch (E.deviceType) {
      case S.DeviceType.NomadE:
      case S.DeviceType.NomadEV2:
        return ot;
      case S.DeviceType.Knob:
        return rt;
      case S.DeviceType.KnobF1:
        return tt;
    }
  };
  return C.jsx(nt, { currentScreen: G.widgets, changeCurrentScreen: Ge, children: C.jsxs("div", { className: A.main_column, children: [C.jsxs("h4", { style: { position: "relative", fontWeight: "lighter" }, children: ["Click and drag to move the wallpaper, scroll to resize.", C.jsx("br", {}), `min size ${Z()}pxx${k()}px, max 1mb`] }), C.jsxs("div", { className: A.select_image_stack, children: [c ? C.jsx("div", { className: A.crop_image, children: C.jsx(Tt, { showGrid: false, style: { containerStyle: { color: "var(--color-white)", borderRadius: "25px" }, mediaStyle: { bottom: 0 }, cropAreaStyle: { borderRadius: "12px", border: "1px solid var(--color-white)", boxShadow: "0 0 0 9999em #F2F2F233" } }, image: c, crop: u, aspect: Z() / k(), zoom: d, onCropChange: m, onCropComplete: je, onZoomChange: We, restrictPosition: true }) }) : C.jsx("div", { className: A.wallpaper_image, children: C.jsx("img", { src: i !== void 0 ? i : Ke(), style: { borderRadius: "15px" } }) }), C.jsx("div", { className: A.choose_image_overlay_button, children: C.jsx(oe, { text: "Choose Image", onClick: Ie }) }), C.jsx("input", { type: "file", ref: a, accept: re ? ".png,.jpg,.jpeg,.webp,.gif" : ".png,.jpg,.jpeg,.webp", onChange: Ze, style: { display: "none" } })] }), C.jsxs("div", { className: A.actions_column, children: [T && C.jsx("h5", { className: A.wallpaper_message, children: T }), I === "image/gif" && !E.isUsbConnection && C.jsx("h5", { className: A.wallpaper_message, children: "GIF uploads over Bluetooth can be slow. Use USB for a faster upload." }), O !== void 0 && C.jsx("h5", { className: A.wallpaper_message, children: "GIF has more than the allowed number of frames." }), c && C.jsx(oe, { text: Be(), subtext: void 0, onClick: Le, error: y === 2 }), C.jsx(oe, { text: "Discard", onClick: ke })] })] }) });
}
export {
  kt as default
};
