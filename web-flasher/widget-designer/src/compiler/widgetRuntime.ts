// ─────────────────────────────────────────────────────────────────────────────
// Widget runtime: renders a widget's HTML+CSS in a real DOM and runs its
// script against that DOM, exactly the way the F1 firmware's render-v2
// pipeline does.
//
// The widget scripts are a small DSL, not plain browser JS. They use:
//   - mod(a, b)            → positive modulo
//   - pick(i, ...variants) → select variant by index (wraps)
//   - formatTime(seconds)  → "HH:MM:SS"
//   - clamp(x, min, max)   → bounded integer (device: clampMin/clampMax opcodes)
//   - widget.on(kind, cb)  → register an event handler
//   - widget.getInt/setInt/commit/isHeld → mailbox slots (raw mquickjs model)
//   - widget.snapshot(spec) → declarative host-data records: the runtime stages
//     them, matches the commit revision, and decodes bit fields, so no widget
//     hand-rolls unpacking or torn-snapshot handling
//   - document.querySelector(...).textContent / .style.color / .hidden
//
// We render the HTML+CSS in a sandboxed iframe (so the author's CSS can't
// leak into the designer), inject the intrinsics + widget shim, run the
// script once to register handlers, then dispatch events into the iframe.
// ─────────────────────────────────────────────────────────────────────────────

import type { SnapshotSchema } from "../data/schemas";

export const INTRINSICS = `
function mod(a, b) {
  a = a | 0; b = b | 0;
  if (b === 0) return 0;
  return ((a % b) + b) % b;
}
function pick(index) {
  var i = index | 0;
  var variants = Array.prototype.slice.call(arguments, 1);
  if (variants.length === 0) return undefined;
  return variants[((i % variants.length) + variants.length) % variants.length];
}
function clamp(value, minimum, maximum) {
  // The SDK's script grammar accepts clamp(x, min, max) and its own focus-timer
  // example uses it, but this intrinsic was missing — so a widget using it
  // compiled to a valid event program and then threw in the preview. The device
  // implements it as clampMin/clampMax opcodes; this matches that ordering.
  var v = value | 0;
  if (v < (minimum | 0)) v = minimum | 0;
  if (v > (maximum | 0)) v = maximum | 0;
  return v;
}
function formatTime(seconds) {
  var s = ((seconds | 0) % 86400 + 86400) % 86400;
  var h = (s / 3600) | 0;
  var m = ((s / 60) | 0) % 60;
  var sec = s % 60;
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return p(h) + ":" + p(m) + ":" + p(sec);
}
function digits(value, count) {
  // v3 digit composition: the transpiler lowers digits(value, N) onto N device
  // slots, each carrying mod((value / 10^k) | 0, 10). This preview intrinsic
  // formats the SAME digit sequence as text (zero-padded, high digits
  // truncated), so the preview shows exactly what the per-digit rasters will.
  var n = count | 0;
  if (n < 1) n = 1;
  if (n > 4) n = 4;
  var v = value | 0;
  var out = "";
  for (var k = 0; k < n; k++) {
    out = String.fromCharCode(48 + (((v % 10) + 10) % 10)) + out;
    v = (v / 10) | 0;
  }
  return out;
}
`;

const WIDGET_SHIM = `
var __schemas = __SCHEMAS__;
var __slots = new Array(16).fill(0);
var __handlers = {};
var __loading = true;
var __active = false;
var __pending = null;
var __commitRequested = false;

var widget = {
  on: function (name, cb) {
    if (!__loading) throw new TypeError("widget.on is load-only");
    if (typeof cb !== "function") throw new TypeError("widget.on requires a function");
    var key = String(name);
    if (key.indexOf("host.rpc:") === 0) {
      var id = Number(key.slice("host.rpc:".length));
      if (!Number.isInteger(id) || id < 1 || id > 0xffff) throw new TypeError("Bad host.rpc selector");
      key = "host.rpc:" + id;
    }
    if (__handlers[key]) throw new TypeError("Duplicate handler for " + key);
    __handlers[key] = cb;
  },
  getInt: function (slot) {
    if (!__active) throw new TypeError("widget.getInt requires active callback");
    return __pending[slot];
  },
  setInt: function (slot, value) {
    if (!__active) throw new TypeError("widget.setInt requires active callback");
    __pending[slot] = value | 0;
  },
  commit: function () {
    if (!__active) throw new TypeError("widget.commit requires active callback");
    __commitRequested = true;
  },
  keys: function () {
    // Load-time declaration of the admitted key set (any-key input); the
    // preview accepts and drops it — token admission is a device concern.
    if (!__loading) throw new TypeError("widget.keys is load-only");
    for (var i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] !== "string") throw new TypeError("widget.keys takes string key names");
    }
    if (arguments.length === 0) throw new TypeError("widget.keys takes 1..16 string key names");
  },
  snapshot: function (name, spec) {
    if (!__loading) throw new TypeError("widget.snapshot is load-only");
    __installSnapshot(name, spec);
  },
  animate: function (selector, frames) {
    // v3 CSS animation sampling. In the preview this is declaration-only: the
    // element's native CSS animation already plays live, and the transpiler
    // lowers the declaration into a device-side tick.100ms frame counter. The
    // validation here mirrors the transpiler's diagnostics so a script that
    // loads in the preview also transpiles.
    if (!__loading) throw new TypeError("widget.animate is load-only");
    if (typeof selector !== "string" || selector.charAt(0) !== "#" || selector.length < 2) {
      throw new TypeError('widget.animate requires a "#id" selector');
    }
    if (!Number.isInteger(frames) || frames < 2 || frames > 16) {
      throw new TypeError("widget.animate frames must be an integer 2..16");
    }
  },
  isHeld: function (event, keyId) {
    if (!__active) throw new TypeError("widget.isHeld requires active callback");
    return Boolean(((event && event.heldMask) || 0) >>> keyId & 1);
  }
};

function __dispatch(event) {
  var selectorText = event.name || event.type || event.kind || "";
  var key = selectorText;
  if (selectorText.indexOf("host.rpc") === 0 && event.id != null) {
    key = "host.rpc:" + event.id;
  }
  var cb = __handlers[key];
  if (!cb) return { handled: false, committed: false, slots: __slots.slice() };
  // Mirror the device's per-kind event object exactly (build_event_object in
  // framer_mquickjs_canary.c): knob gets delta+fn and no value; keys get
  // key/repeat/holdCount/reason and no id; chords get chord+reason. A field the
  // device does not send must not exist here either, or widgets grow preview-only
  // dependencies that silently break on the keyboard.
  var base = {
    type: selectorText,
    sequence: event.sequence | 0 || 1,
    timestampMs: event.timestampMs | 0,
    heldMask: (event.heldMask != null ? event.heldMask : event.mask) | 0,
    synthetic: Boolean(event.synthetic)
  };
  if (selectorText === "input.fn-bottom-knob") {
    base.delta = (event.delta != null ? event.delta : event.value) | 0;
    base.fn = true;
    base.auxiliary = event.auxiliary | 0;
  } else if (selectorText.indexOf("host.rpc") === 0) {
    base.id = event.id | 0;
    base.value = event.value | 0;
    base.auxiliary = event.auxiliary | 0;
  } else if (selectorText.indexOf("input.key.") === 0) {
    base.key = (event.key != null ? event.key : event.id) | 0;
    base.repeat = event.repeat != null ? Boolean(event.repeat) : selectorText === "input.key.hold";
    base.holdCount = event.holdCount | 0;
    base.reason = event.reason | 0;
  } else if (selectorText.indexOf("input.chord.") === 0) {
    base.chord = (event.chord != null ? event.chord : (event.mask != null ? event.mask : event.id)) | 0;
    base.reason = event.reason | 0;
  } else {
    base.value = event.value | 0;
    base.auxiliary = event.auxiliary | 0;
  }
  var ev = Object.freeze(base);
  __pending = __slots.slice();
  __commitRequested = false;
  __active = true;
  var error;
  try { cb(ev); } catch (e) { error = String(e && e.message || e); }
  __active = false;
  if (__commitRequested) __slots = __pending.slice();
  __pending = null;
  return { handled: true, committed: __commitRequested, slots: __slots.slice(), error: error };
}

// ── Host data snapshots ──────────────────────────────────────────────────────
//
// A widget names a schema and gets decoded values. It never writes a bit
// offset, a mask, or sign-extension, and never handles staging or torn
// snapshots:
//
//   widget.snapshot("weather", {
//     apply: function (data) {
//       document.querySelector("#temp").textContent = data.current.temperature;
//       document.querySelector("#cond").textContent = data.current.conditionLabel;
//     }
//   });
//
// Schemas are injected from src/data/schemas.ts, where fields declare widths in
// order and offsets are derived. Fields with labels also arrive as
// <field>Label, so widgets render names rather than magic numbers.
//
// apply() runs only when the commit revision matches the begin AND every
// declared record has arrived.
function __decodeRecord(record) {
  return function (packed) {
    var out = {};
    var cursor = 0;
    Object.keys(record.fields).forEach(function (field) {
      var spec = record.fields[field];
      var mask = spec.bits >= 32 ? 0xffffffff : (1 << spec.bits) - 1;
      var raw = (packed >>> cursor) & mask;
      if (spec.signed && spec.bits < 32 && raw >= (1 << (spec.bits - 1))) raw -= (1 << spec.bits);
      out[field] = raw;
      if (spec.labels) out[field + "Label"] = spec.labels[raw] || String(raw);
      cursor += spec.bits;
    });
    return out;
  };
}

function __installSnapshot(name, spec) {
  if (typeof name !== "string") throw new TypeError("widget.snapshot(name, { apply }) requires a schema name");
  var schema = __schemas[name];
  if (!schema) {
    throw new TypeError("Unknown host-data schema '" + name + "'. Known: " + Object.keys(__schemas).join(", "));
  }
  if (!spec || typeof spec.apply !== "function") throw new TypeError("widget.snapshot requires apply()");
  spec = { begin: schema.begin, commit: schema.commit, records: schema.records, apply: spec.apply };
  var names = Object.keys(spec.records || {});
  if (names.length === 0) throw new TypeError("Schema '" + name + "' declares no records");

  var pending = 0;
  var staged = {};

  widget.on("host.rpc:" + spec.begin, function (event) {
    pending = event.value;
    staged = {};                  // a new begin discards anything half-staged
  });

  names.forEach(function (name) {
    var record = spec.records[name];
    var decode = __decodeRecord(record);
    widget.on("host.rpc:" + record.id, function (event) {
      var decoded = decode(event.value);
      decoded.raw = event.value;
      staged[name] = decoded;
    });
  });

  widget.on("host.rpc:" + spec.commit, function (event) {
    if (event.value !== pending) return;          // torn or stale snapshot
    for (var i = 0; i < names.length; i++) {
      if (!staged[names[i]]) return;              // incomplete snapshot
    }
    var data = {};
    names.forEach(function (name) { data[name] = staged[name]; });
    data.revision = event.value;
    spec.apply(data);
  });
}

function __reset() {
  __slots = new Array(16).fill(0);
  __pending = null;
  __commitRequested = false;
  __active = false;
}

window.__widgetRuntime = {
  dispatch: __dispatch,
  reset: __reset,
  handlerCount: function () { return Object.keys(__handlers).length; }
};

// ── Parent bridge ──────────────────────────────────────────────────────────
// The preview iframe is sandboxed with allow-scripts but NOT allow-same-origin,
// so it sits in an opaque origin: the designer cannot touch contentDocument or
// reach __widgetRuntime directly. (bindWidgetRuntime therefore always throws.)
// postMessage is the one channel that crosses an opaque origin, so driving the
// widget and reading back its rendered DOM both go through here.
//
// Replies target "*" because an opaque origin serializes to "null"; the channel
// carries no secrets, only the widget's own markup, and every inbound message
// is matched against a known type before it does anything.
window.addEventListener("message", function (event) {
  var message = event.data;
  if (!message || typeof message !== "object" || !event.source) return;
  var reply = function (payload) {
    payload.id = message.id;
    event.source.postMessage(payload, "*");
  };
  try {
    if (message.type === "widget:dispatch") {
      reply({ type: "widget:dispatch:result", result: __dispatch(message.event || {}) });
    } else if (message.type === "widget:reset") {
      __reset();
      reply({ type: "widget:reset:result" });
    } else if (message.type === "widget:setText") {
      // Used when capturing F2EP binding variants: each variant needs the
      // target rendered with one glyph substituted, then read back as pixels.
      // getElementById, not querySelector("#"+id): concatenating into a
      // selector throws on any id that is not a valid CSS identifier.
      // message.id is the bridge's correlation id, not the element's.
      var node = document.getElementById(String(message.elementId));
      if (node) node.textContent = message.text;
      reply({ type: "widget:setText:result", applied: Boolean(node) });
    } else if (message.type === "widget:setColor") {
      // Used when capturing variantRaster colour variants: the raster for a
      // colour-slotted variant must be captured WITH that colour applied, so
      // the blitted pixels carry it. Mirrors widget:setText exactly; an empty
      // string clears the inline colour back to the stylesheet's.
      var colorNode = document.getElementById(String(message.elementId));
      if (colorNode) colorNode.style.color = String(message.color == null ? "" : message.color);
      reply({ type: "widget:setColor:result", applied: Boolean(colorNode) });
    } else if (message.type === "widget:setClass") {
      // Class-swap variant capture (v3): the variant class is APPENDED to the
      // element's AUTHORED className, so base styling stays underneath and the
      // variant class layers on top — exactly what the device shows when the
      // slot picks that variant's raster. The authored value is remembered on
      // first touch; an empty string restores it verbatim. Mirrors
      // widget:setText's applied contract.
      var classNode = document.getElementById(String(message.elementId));
      if (classNode) {
        if (classNode.__authoredClassName === undefined) classNode.__authoredClassName = classNode.className;
        var variantClass = String(message.className == null ? "" : message.className);
        classNode.className = variantClass === ""
          ? classNode.__authoredClassName
          : (classNode.__authoredClassName === ""
              ? variantClass
              : classNode.__authoredClassName + " " + variantClass);
      }
      reply({ type: "widget:setClass:result", applied: Boolean(classNode) });
    } else if (message.type === "widget:setHidden") {
      // Pixel-true blanking for hidden-capable targets (v3): the hidden
      // variant ships the blanked-base pixels of the rect, so the base must
      // hold what is BEHIND the element — visibility (not display) removes
      // its painting without reflowing siblings, keeping every other target's
      // measured geometry valid. An empty flag clears back to the stylesheet.
      var hideNode = document.getElementById(String(message.elementId));
      if (hideNode) hideNode.style.visibility = message.hidden ? "hidden" : "";
      reply({ type: "widget:setHidden:result", applied: Boolean(hideNode) });
    } else if (message.type === "widget:probeAnimation") {
      // widget.animate() capture precondition: sampling frames of an element
      // with no CSS animation would ship "frames" identical rasters, so the
      // assembler asks first and refuses with the element named.
      var probeNode = document.getElementById(String(message.elementId));
      var animationName = "";
      if (probeNode) animationName = String(getComputedStyle(probeNode).animationName || "none");
      reply({ type: "widget:probeAnimation:result", applied: Boolean(probeNode), animationName: animationName });
    } else if (message.type === "widget:freezeAnimation") {
      // Freeze the element's CSS animation at one sample time: a NEGATIVE
      // animation-delay seeks the timeline and paused pins it there, so the
      // capture reads frame k of the flipbook. delay == null removes both
      // inline overrides, resuming the authored animation.
      var freezeNode = document.getElementById(String(message.elementId));
      if (freezeNode) {
        if (message.delay == null) {
          freezeNode.style.removeProperty("animation-delay");
          freezeNode.style.removeProperty("animation-play-state");
        } else {
          freezeNode.style.setProperty("animation-delay", String(message.delay));
          freezeNode.style.setProperty("animation-play-state", "paused");
        }
      }
      reply({ type: "widget:freezeAnimation:result", applied: Boolean(freezeNode) });
    } else if (message.type === "widget:measureRect") {
      // The element's own border box, for targets whose pixels are not a text
      // run (class-styled boxes, animated elements): glyph boxes miss
      // backgrounds, borders and transforms, so those targets measure the
      // element rect (getBoundingClientRect includes transforms).
      var rectNode = document.getElementById(String(message.elementId));
      var elementBox = null;
      if (rectNode) {
        var bounds = rectNode.getBoundingClientRect();
        elementBox = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
      }
      reply({ type: "widget:measureRect:result", applied: Boolean(rectNode), box: elementBox });
    } else if (message.type === "widget:measure") {
      // Per-character boxes for a text run. Capturing a glyph in its own advance
      // box makes the pixels position-independent, so the same glyph at any
      // position yields identical bytes and the linker can share one patch set
      // across every digit — which is how the SDK's own semantic path fits a
      // six-digit clock into 15 variants instead of 60.
      var target = document.getElementById(String(message.elementId));
      var boxes = [];
      if (target && target.firstChild) {
        var textNode = target.firstChild;
        var length = (textNode.textContent || "").length;
        for (var i = 0; i < length; i += 1) {
          var range = document.createRange();
          range.setStart(textNode, i);
          range.setEnd(textNode, i + 1);
          var r = range.getBoundingClientRect();
          boxes.push({ x: r.left, y: r.top, width: r.width, height: r.height });
        }
      }
      reply({ type: "widget:measure:result", boxes: boxes });
    } else if (message.type === "widget:snapshot") {
      var clone = document.body.cloneNode(true);
      var scripts = clone.querySelectorAll("script");
      for (var i = 0; i < scripts.length; i += 1) scripts[i].parentNode.removeChild(scripts[i]);
      var serializer = new XMLSerializer();
      var markup = "";
      for (var j = 0; j < clone.childNodes.length; j += 1) {
        markup += serializer.serializeToString(clone.childNodes[j]);
      }
      reply({ type: "widget:snapshot:result", body: markup, error: window.__widgetError || null });
    }
  } catch (e) {
    reply({ type: (message.type || "widget") + ":error", error: String((e && e.message) || e) });
  }
});
`;

export function buildWidgetSrcdoc(opts: {
  html: string;
  css: string;
  script: string;
  rootClass: string;
  /** The widget's own host-data schemas, injected for widget.snapshot(). */
  hostData?: Record<string, SnapshotSchema>;
}): string {
  const { html, css, script, hostData = {} } = opts;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 100px; height: 310px; overflow: hidden; background: #000; }
  ${css}
</style>
</head>
<body>
${html}
<script>
${INTRINSICS}
${WIDGET_SHIM.replace("__SCHEMAS__", JSON.stringify(hostData))}
try {
  ${script}
} catch (e) {
  window.__widgetError = String(e && e.message || e);
}
__loading = false;
</script>
</body>
</html>`;
}

/**
 * NOTE: there is deliberately no bindWidgetRuntime() here.
 *
 * It used to reach into iframe.contentWindow.__widgetRuntime, which cannot work:
 * the preview is sandboxed allow-scripts WITHOUT allow-same-origin, so it is an
 * opaque origin and that access always threw. Callers caught the throw and
 * silently fell back, which is why injected events appeared to do nothing for a
 * long time. Use dispatchToPreview()/requestWidgetBody() in compiler/snapshot.ts
 * — the postMessage bridge is the only channel that crosses an opaque origin.
 */

