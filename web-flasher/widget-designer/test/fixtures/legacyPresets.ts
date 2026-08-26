// Legacy example presets, verbatim as they last shipped in the Designer.
// The UI no longer offers them (docs/17-era cleanup: real, learnable examples
// only), but the compilers still support their grammars - these fixtures keep
// that coverage exercised exactly as before.
import type { DesignerWidget } from "../../src/types";
import { WEATHER_SCHEMA } from "../../src/data/schemas";

export const LEGACY_PRESETS: Record<string, DesignerWidget> = {
  events: {
    name: "Tick + knob + host",
    rootClass: "render-v2",
    html: `<div class="render-v2">
  <span id="clock" data-glyphs="0123456789:">12:34:56</span>
  <span id="knob" data-glyphs="123">1</span>
  <span id="host" data-glyphs="0123456789">0</span>
  <span>V</span><span>2</span><span>E</span><span>V</span><span>E</span><span>N</span><span>T</span>
</div>`,
    css: `.render-v2 {
  width: 100%; height: 100%; overflow: hidden;
  display: grid; grid-template-columns: repeat(5, 20px);
  grid-auto-rows: 20px; min-width: 100px; min-height: 310px;
  background-color: #050a17; color: rgba(89,226,255,1);
  font-size: 12px; font-family: "Courier New", Courier, monospace;
  justify-content: center; align-content: center;
}
.render-v2 > span {
  color: rgba(89,226,255,1);
  text-shadow: 0 0 2px rgba(89,226,255,0.5);
  text-align: center; user-select: none; line-height: 1;
}`,
    script: `var secondsOfDay = 45296;
var knobVariant = 0;
var hostValue = 0;

widget.on("tick.1s", function (event) {
  secondsOfDay = secondsOfDay + 1;
  secondsOfDay = mod(secondsOfDay, 86400);
  document.querySelector("#clock").textContent = formatTime(secondsOfDay);
});

widget.on("input.fn-bottom-knob", function (event) {
  knobVariant += event.delta;
  knobVariant = mod(knobVariant, 3);
  document.querySelector("#knob").textContent = pick(knobVariant, "1", "2", "3");
});

widget.on("host.rpc:0xB201", function (event) {
  hostValue = event.value;
  hostValue = mod(hostValue, 10);
  document.querySelector("#host").textContent = pick(hostValue,
    "0","1","2","3","4","5","6","7","8","9");
  document.querySelector("#host").style.color = pick(hostValue,
    "#59E2FF","#42DCE1","#5BE89E","#8FE16C","#D3D54E",
    "#FFB74D","#FF875B","#FF5F97","#DE5BE2","#BB6AFF");
});
`,
    states: [
      { name: "secondsOfDay", initial: 45296 },
      { name: "knobVariant", initial: 0 },
      { name: "hostValue", initial: 0 },
    ],
    handlers: [
      { id: "tick.1s", selector: "tick.1s", body: `secondsOfDay = secondsOfDay + 1;\n  secondsOfDay = mod(secondsOfDay, 86400);\n  document.querySelector("#clock").textContent = formatTime(secondsOfDay);` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `knobVariant += event.delta;\n  knobVariant = mod(knobVariant, 3);\n  document.querySelector("#knob").textContent = pick(knobVariant, "1", "2", "3");` },
      { id: "host.rpc:0xB201", selector: "host.rpc:0xB201", body: `hostValue = event.value;\n  hostValue = mod(hostValue, 10);\n  document.querySelector("#host").textContent = pick(hostValue, "0","1","2","3","4","5","6","7","8","9");\n  document.querySelector("#host").style.color = pick(hostValue, "#59E2FF","#42DCE1","#5BE89E","#8FE16C","#D3D54E","#FFB74D","#FF875B","#FF5F97","#DE5BE2","#BB6AFF");` },
    ],
    targets: [
      { id: "clock", writes: ["textContent"] },
      { id: "knob", writes: ["textContent"] },
      { id: "host", writes: ["textContent", "color"] },
    ],
    hasRasterBase: true,
  },

  focusDial: {
    name: "Focus dial",
    rootClass: "render-v2",
    html: `<div class="render-v2">
  <span>F</span><span>O</span><span>C</span><span>U</span><span>S</span>
  <span id="stage" data-glyphs="IDEALFOCUSBREAK">IDEAL</span>
  <span id="clock" data-glyphs="0123456789:">25:00</span>
  <span id="rings" data-glyphs="012345">0</span>
  <span>·</span><span>·</span><span>·</span><span>·</span><span>·</span>
</div>`,
    css: `.render-v2 {
  width: 100%; height: 100%; overflow: hidden;
  display: grid; grid-template-columns: repeat(5, 20px);
  grid-auto-rows: 20px; min-width: 100px; min-height: 310px;
  background-color: #0a1226; color: rgba(255,183,77,1);
  font-size: 12px; font-family: "JetBrains Mono", monospace;
  justify-content: center; align-content: center;
}
.render-v2 > span {
  text-align: center; line-height: 1; user-select: none;
  text-shadow: 0 0 2px currentColor;
}
/* The subset has no #id selectors, so per-run accents address the span order
   of this markup: 6=#stage, 7=#clock, 8=#rings. font-weight has no policy at
   any scope, so #stage is no longer bold. */
.render-v2 > span:nth-child(6) { color: #5BE89E; }
.render-v2 > span:nth-child(7) { color: #FFB74D; }
.render-v2 > span:nth-child(8) { color: #BB6AFF; }
`,
    // Written in the render-v2 script subset (integer state, mod/pick, DOM
    // assignments last) so this preset compiles to an F2EP event program and
    // the knob moves pixels on device. The subset has no branches and no
    // arithmetic beyond +=/mod/clamp, so the stage durations are picked labels
    // rather than a live mm:ss countdown, which it cannot express.
    // clamp() is now available in the preview intrinsics too
    // (compiler/widgetRuntime.ts), matching the device's clampMin/clampMax
    // ordering; this preset just predates it and has no need for it.
    script: `var stage = 0;
var rings = 0;

widget.on("tick.1s", function (event) {
  rings += 1;
  rings = mod(rings, 6);
  document.querySelector("#rings").textContent = pick(rings, "0", "1", "2", "3", "4", "5");
});

widget.on("input.fn-bottom-knob", function (event) {
  stage += event.delta;
  stage = mod(stage, 3);
  document.querySelector("#stage").textContent = pick(stage, "IDEAL", "FOCUS", "BREAK");
  document.querySelector("#clock").textContent = pick(stage, "25:00", "25:00", "05:00");
});
`,
    states: [
      { name: "stage", initial: 0 },
      { name: "rings", initial: 0 },
    ],
    handlers: [
      { id: "tick.1s", selector: "tick.1s", body: `rings += 1;` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `stage += event.delta;` },
    ],
    targets: [
      { id: "stage", writes: ["textContent"] },
      { id: "clock", writes: ["textContent"] },
      { id: "rings", writes: ["textContent"] },
    ],
    hasRasterBase: false,
  },

  weather: {
    name: "Weather",
    rootClass: "weather-v2",
    hostData: { weather: WEATHER_SCHEMA },
    renderMode: "raster",
    html: `<div class="weather-v2" aria-label="Weather">
  <div class="weather-mark" aria-hidden="true"><i></i><b></b></div>
  <span class="weather-location" id="location">\u2014</span>
  <span class="weather-title">Today</span>
  <div class="weather-current"><strong id="temp">\u2014</strong><span id="condition">\u2014</span></div>
  <div class="weather-forecast">
    <div class="weather-day"><span id="day-1">\u2014</span><b id="low-1">\u2014</b><i id="forecast-1">\u2192</i><b id="high-1">\u2014</b></div>
    <div class="weather-day"><span id="day-2">\u2014</span><b id="low-2">\u2014</b><i id="forecast-2">\u2192</i><b id="high-2">\u2014</b></div>
    <div class="weather-day"><span id="day-3">\u2014</span><b id="low-3">\u2014</b><i id="forecast-3">\u2192</i><b id="high-3">\u2014</b></div>
  </div>
</div>`,
    css: `.weather-v2{position:relative;width:100px;height:310px;overflow:hidden;background:#000;color:#f5f5f4;font-family:"HKNova",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.weather-mark{position:absolute;left:41px;top:17px;width:24px;height:17px}
.weather-mark i,.weather-mark b{position:absolute;display:block;background:#f5f5f4}
.weather-mark i{left:0;bottom:0;width:24px;height:11px;border-radius:6px}
.weather-mark b{right:3px;top:0;width:11px;height:11px;border-radius:50%}
.weather-location{position:absolute;left:8px;right:8px;top:39px;height:12px;color:#8c8782;text-align:center;font:600 7px/12px "HKNova",ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden}
.weather-title{position:absolute;left:8px;right:8px;top:57px;height:30px;text-align:center;font:500 22px/30px "HKNova",ui-sans-serif,system-ui,sans-serif}
.weather-current{position:absolute;box-sizing:border-box;left:8px;top:99px;width:84px;height:74px;border-radius:10px;background:#ff8a00;color:#090909;text-align:center;display:flex;flex-direction:column;justify-content:center}
.weather-current strong{display:block;font:500 31px/34px "HKNova",ui-sans-serif,system-ui,sans-serif;letter-spacing:-1px}
.weather-current span{display:block;font:600 13px/19px "HKNova",ui-sans-serif,system-ui,sans-serif}
.weather-forecast{position:absolute;left:8px;top:190px;width:84px;height:102px;display:grid;grid-template-rows:repeat(3,34px)}
.weather-day{display:grid;grid-template-columns:31px 18px 13px 18px;align-items:center;width:84px;height:34px;color:#f5f5f4;font:600 11px/34px ui-monospace,SFMono-Regular,Menlo,monospace}
.weather-day span{text-align:left}.weather-day b{font:inherit;text-align:right}.weather-day i{font:600 15px/34px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;font-style:normal}
#forecast-1{color:#ff8a00}#forecast-2,#forecast-3{color:#77736f}`,
    script: `// Names its data source. No ids, no bit offsets, no staging logic —
// the layout lives once in src/data/schemas.ts and the runtime decodes it.
var selectedDay = 0;

function paintSelection() {
  document.querySelector("#forecast-1").style.color = pick(selectedDay, "#FF8A00", "#77736F", "#77736F");
  document.querySelector("#forecast-2").style.color = pick(selectedDay, "#77736F", "#FF8A00", "#77736F");
  document.querySelector("#forecast-3").style.color = pick(selectedDay, "#77736F", "#77736F", "#FF8A00");
}

function showDay(slot, day) {
  document.querySelector("#day-" + slot).textContent = day.weekdayLabel;
  document.querySelector("#low-" + slot).textContent = String(day.low);
  document.querySelector("#high-" + slot).textContent = String(day.high);
}

widget.snapshot("weather", {
  apply: function (data) {
    document.querySelector("#temp").textContent = String(data.current.temperature) + "\u00B0";
    document.querySelector("#condition").textContent = data.current.conditionLabel;
    showDay(1, data.day1);
    showDay(2, data.day2);
    showDay(3, data.day3);
    document.querySelector("#location").textContent = "LIVE " + data.revision;
    paintSelection();
  }
});

widget.on("input.fn-bottom-knob", function (event) {
  selectedDay += event.delta;
  selectedDay = mod(selectedDay, 3);
  paintSelection();
});`,
    states: [
      { name: "selectedDay", initial: 0 },
      { name: "pendingRevision", initial: 0 },
      { name: "liveRevision", initial: 0 },
    ],
    handlers: [
      { id: "host.rpc:0xB240", selector: "host.rpc:0xB240", body: `pendingRevision = event.value;` },
      { id: "host.rpc:0xB241", selector: "host.rpc:0xB241", body: `current temperature + condition` },
      { id: "host.rpc:0xB242", selector: "host.rpc:0xB242", body: `forecast day 1` },
      { id: "host.rpc:0xB243", selector: "host.rpc:0xB243", body: `forecast day 2` },
      { id: "host.rpc:0xB244", selector: "host.rpc:0xB244", body: `forecast day 3` },
      { id: "host.rpc:0xB24F", selector: "host.rpc:0xB24F", body: `commit if revision matches` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `selectedDay += event.delta;` },
    ],
    targets: [
      { id: "temp", writes: ["textContent"] },
      { id: "condition", writes: ["textContent"] },
      { id: "location", writes: ["textContent"] },
      { id: "forecast-1", writes: ["textContent", "color"] },
      { id: "forecast-2", writes: ["textContent", "color"] },
      { id: "forecast-3", writes: ["textContent", "color"] },
    ],
    hasRasterBase: true,
  },

  pulse: {
    name: "Pulse (v3 showcase)",
    rootClass: "pulse-v3",
    html: `<div class="pulse-v3" aria-label="Pulse">
  <div class="pulse-spinner" id="spinner" aria-hidden="true"></div>
  <span class="pulse-title">PULSE</span>
  <span class="pulse-badge" id="badge">READY</span>
  <span class="pulse-count" id="count">000</span>
  <span class="pulse-toast" id="toast">SYNCED</span>
  <div class="pulse-beat" id="beat" aria-hidden="true"></div>
</div>`,
    css: `.pulse-v3{position:relative;width:100px;height:310px;overflow:hidden;background:linear-gradient(180deg,#04060f 0%,#0a1226 60%,#101b3a 100%);color:#f5f5f4;font-family:ui-sans-serif,system-ui,sans-serif}
.pulse-spinner{position:absolute;left:41px;top:20px;width:18px;height:18px;border-radius:50%;border:3px solid rgba(89,226,255,.18);border-top-color:#59e2ff;animation:pulse-spin .6s linear infinite}
@keyframes pulse-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.pulse-title{position:absolute;left:0;right:0;top:56px;text-align:center;font:700 16px/20px ui-sans-serif,system-ui,sans-serif;letter-spacing:4px;color:#8fb6ff}
.pulse-badge{position:absolute;left:10px;right:10px;top:96px;height:22px;border-radius:11px;text-align:center;font:700 11px/22px ui-sans-serif,system-ui,sans-serif;letter-spacing:1px}
.pulse-badge.state-ok{background:linear-gradient(90deg,#0f5132,#2ec27e);color:#eafff4;box-shadow:0 0 8px rgba(46,194,126,.7)}
.pulse-badge.state-warn{background:linear-gradient(90deg,#7a4d00,#ffb74d);color:#241300;box-shadow:0 0 8px rgba(255,183,77,.7)}
.pulse-badge.state-err{background:linear-gradient(90deg,#7a0f2b,#ff5f97);color:#fff;box-shadow:0 0 8px rgba(255,95,151,.7)}
.pulse-count{position:absolute;left:0;right:0;top:152px;text-align:center;font:700 22px/26px "Courier New",ui-monospace,monospace;letter-spacing:1px;color:#f5f5f4;font-variant-numeric:tabular-nums;text-shadow:0 0 6px rgba(89,226,255,.5)}
.pulse-toast{position:absolute;left:12px;right:12px;top:214px;height:20px;border-radius:6px;background:#59e2ff;color:#04121c;text-align:center;font:700 10px/20px ui-sans-serif,system-ui,sans-serif;letter-spacing:2px}
.pulse-beat{position:absolute;left:44px;top:260px;width:12px;height:12px;border-radius:50%;background:#ff5f97;animation:pulse-beat .8s ease-in-out infinite}
@keyframes pulse-beat{0%,100%{transform:scale(.55);opacity:.45}50%{transform:scale(1.25);opacity:1}}`,
    // Every v3 authoring feature on one screen: two sampled CSS animations
    // (spinner 8f, heartbeat 16f), gradient class states on the badge, a
    // 3-digit live counter in the design font, and a hideable toast.
    script: `var state = 0;
var count = 0;
var toastOn = 1;

widget.animate("#spinner", 6);
widget.animate("#beat", 8);

widget.on("input.fn-bottom-knob", function (event) {
  state = mod(state + event.delta, 3);
  document.querySelector("#badge").className = pick(state, "pulse-badge state-ok", "pulse-badge state-warn", "pulse-badge state-err");
  document.querySelector("#badge").textContent = pick(state, "READY", "BUSY", "ALERT");
});

widget.on("input.key.down", function (event) {
  count = clamp(count + 1, 0, 999);
  document.querySelector("#count").textContent = digits(count, 3);
});

widget.on("input.key.hold", function (event) {
  count = clamp(count + 10, 0, 999);
  document.querySelector("#count").textContent = digits(count, 3);
});

widget.on("input.chord.down", function (event) {
  count = 0;
  document.querySelector("#count").textContent = digits(count, 3);
});

widget.on("host.rpc:0xB201", function (event) {
  toastOn = mod(event.value, 2);
  document.querySelector("#toast").textContent = pick(0, "SYNCED");
  document.querySelector("#toast").hidden = mod(toastOn + 1, 2);
});
`,
    states: [
      { name: "state", initial: 0 },
      { name: "count", initial: 0 },
      { name: "toastOn", initial: 1 },
    ],
    handlers: [
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `badge class+text` },
      { id: "input.key.down", selector: "input.key.down", body: `count +1` },
      { id: "input.key.hold", selector: "input.key.hold", body: `count +10` },
      { id: "input.chord.down", selector: "input.chord.down", body: `count reset` },
      { id: "host.rpc:0xB201", selector: "host.rpc:0xB201", body: `toast show/hide` },
    ],
    targets: [
      { id: "spinner", writes: ["animation"] },
      { id: "beat", writes: ["animation"] },
      { id: "badge", writes: ["textContent", "className"] },
      { id: "count", writes: ["textContent"] },
      { id: "toast", writes: ["textContent", "hidden"] },
    ],
  },

  pomodoro: {
    name: "Pomodoro",
    rootClass: "render-v2",
    html: `<div class="render-v2">
  <span id="state" data-glyphs="WORKRESTLONG">WORK</span>
  <span id="mm" data-glyphs="0125">25</span>
  <span id="colon">:</span>
  <span id="ss">00</span>
  <span>·</span>
  <span id="cycle" data-glyphs="012345">1</span>
  <span>/</span>
  <span>4</span>
</div>`,
    css: `.render-v2 {
  width: 100%; height: 100%; overflow: hidden;
  display: grid; grid-template-columns: repeat(5, 20px);
  grid-auto-rows: 20px; min-width: 100px; min-height: 310px;
  background-color: #1b0f1f; color: #FF5F97;
  font-family: "JetBrains Mono", monospace;
  justify-content: center; align-content: center;
}
.render-v2 > span {
  text-align: center; line-height: 1;
  text-shadow: 0 0 2px currentColor;
  user-select: none;
}
/* Same rewrite as Focus dial: 1=#state, 2..4=#mm/#colon/#ss, 6=#cycle. The
   subset allows font-size on the root only and font-weight nowhere, so the
   timer digits lose their 22px/800 emphasis and render at the root size. */
.render-v2 > span:nth-child(1) { color: #BB6AFF; }
.render-v2 > span:nth-child(2) { color: #FFB74D; }
.render-v2 > span:nth-child(3) { color: #FFB74D; }
.render-v2 > span:nth-child(4) { color: #FFB74D; }
.render-v2 > span:nth-child(6) { color: #5BE89E; }
`,
    // Render-v2 script subset, so this compiles to an F2EP event program.
    // `cycle` is 0-based because the subset matches a pick() variant to the
    // initial state by index; the label it selects is still 1..4. Per-second
    // mm:ss cannot be expressed (no branches, and pick() caps at 16 variants),
    // so the tick advances the phase and #mm shows that phase's duration.
    script: `var phase = 0;
var cycle = 0;

widget.on("tick.1s", function (event) {
  phase += 1;
  phase = mod(phase, 3);
  document.querySelector("#state").textContent = pick(phase, "WORK", "REST", "LONG");
  document.querySelector("#mm").textContent = pick(phase, "25", "05", "15");
});

widget.on("input.fn-bottom-knob", function (event) {
  cycle += event.delta;
  cycle = mod(cycle, 4);
  document.querySelector("#cycle").textContent = pick(cycle, "1", "2", "3", "4");
});
`,
    states: [
      { name: "phase", initial: 0 },
      { name: "cycle", initial: 0 },
    ],
    handlers: [
      { id: "tick.1s", selector: "tick.1s", body: `phase += 1;` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `cycle += event.delta;` },
    ],
    targets: [
      { id: "state", writes: ["textContent"] },
      { id: "mm", writes: ["textContent"] },
      { id: "cycle", writes: ["textContent"] },
    ],
    hasRasterBase: true,
  },
};
