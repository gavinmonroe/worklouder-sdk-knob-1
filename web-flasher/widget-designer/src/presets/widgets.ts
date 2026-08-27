// Curated example widgets that ship with the designer. Each demonstrates one
// capability of the render-v2 / mquickjs pipeline.

import type { DesignerWidget } from "../types";

export const PRESETS: Record<string, DesignerWidget> = {
  counter: {
    name: "Tally counter",
    rootClass: "tally-v3",
    html: `<div class="tally-v3" aria-label="Tally counter">
  <span class="tally-title">TALLY</span>
  <span id="value">000</span>
  <div class="tally-step"><span class="tally-step-label">STEP</span><b id="step">01</b></div>
  <span class="tally-hint">ANY KEY ADDS \u00b7 CHORD RESETS</span>
</div>`,
    css: `.tally-v3{position:relative;width:100px;height:310px;overflow:hidden;background:#0a0d14;color:#e8eaf0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.tally-title{position:absolute;left:0;right:0;top:44px;text-align:center;font:700 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#59e2ff}
#value{position:absolute;left:17px;top:120px;width:66px;height:30px;text-align:center;font:700 26px/30px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#f5f7fa}
.tally-step{position:absolute;left:0;right:0;top:190px;display:flex;align-items:center;justify-content:center;gap:6px}
.tally-step-label{font:600 9px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;color:#77839a}
#step{width:18px;height:14px;text-align:center;font:700 11px/14px ui-monospace,SFMono-Regular,Menlo,monospace;color:#59e2ff;font-style:normal}
.tally-hint{position:absolute;left:6px;right:6px;top:262px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#4a5468}`,
    // The hello-world of the device DSL: one live number, every input kind.
    // Keys add the step, the Fn knob tunes the step, a chord resets, and the
    // 1 Hz heartbeat keeps the widget publishing so it paints from boot.
    script: `var count = 0;
var step = 1;

widget.on("input.key.down", function (event) {
  count = clamp(count + step, 0, 999);
  document.querySelector("#value").textContent = digits(count, 3);
});

widget.on("input.fn-bottom-knob", function (event) {
  step = clamp(step + event.delta, 1, 10);
  document.querySelector("#step").textContent = digits(step, 2);
});

widget.on("input.chord.down", function (event) {
  count = 0;
  document.querySelector("#value").textContent = digits(count, 3);
});

widget.on("tick.1s", function (event) {
  document.querySelector("#value").textContent = digits(count, 3);
});`,
    states: [
      { name: "count", initial: 0 },
      { name: "step", initial: 1 },
    ],
    handlers: [
      { id: "input.key.down", selector: "input.key.down", body: `count += step` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `step tune` },
      { id: "input.chord.down", selector: "input.chord.down", body: `reset` },
      { id: "tick.1s", selector: "tick.1s", body: `heartbeat publish` },
    ],
    targets: [
      { id: "value", writes: ["textContent"] },
      { id: "step", writes: ["textContent"] },
    ],
  },

  clock: {
    name: "Clock",
    rootClass: "clock-v3",
    html: `<div class="clock-v3" aria-label="Clock">
  <span class="clock-title">CLOCK</span>
  <div class="clock-face"><b id="hh">12</b><i id="colon">:</i><b id="mm">00</b></div>
  <span class="clock-hint">KNOB TRIMS MINUTES</span>
  <span class="clock-sub">FED BY HOST RPC 0xB250</span>
</div>`,
    css: `.clock-v3{position:relative;width:100px;height:310px;overflow:hidden;background:#07090f;color:#e8eaf0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.clock-title{position:absolute;left:0;right:0;top:48px;text-align:center;font:700 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#ffb74d}
.clock-face{position:absolute;left:0;right:0;top:130px;display:flex;align-items:center;justify-content:center}
.clock-face b{display:block;width:28px;height:36px;text-align:center;font:700 30px/36px ui-monospace,SFMono-Regular,Menlo,monospace;color:#f5f7fa}
#colon{display:block;width:8px;height:36px;text-align:center;font:700 26px/34px ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffb74d;font-style:normal}
.clock-hint{position:absolute;left:6px;right:6px;top:236px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#4a5468}
.clock-sub{position:absolute;left:6px;right:6px;top:252px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#39404f}`,
    // Digits fed by the HOST: a feeder script sends hh*100+mm on
    // host.rpc:0xB250 and the widget decodes it with the divisor trick. The
    // colon blinks by riding el.hidden on the tick - the background-patch
    // variant the assembler captures automatically.
    script: `var hours = 12;
var minutes = 0;
var blink = 0;

widget.on("host.rpc:0xB250", function (event) {
  hours = mod((event.value / 100) | 0, 24);
  minutes = mod(event.value, 100);
  document.querySelector("#hh").textContent = digits(hours, 2);
  document.querySelector("#mm").textContent = digits(minutes, 2);
});

widget.on("tick.1s", function (event) {
  blink = mod(blink + 1, 2);
  document.querySelector("#colon").textContent = pick(0, ":");
  document.querySelector("#colon").hidden = blink;
  document.querySelector("#hh").textContent = digits(hours, 2);
});

widget.on("input.fn-bottom-knob", function (event) {
  minutes = mod(minutes + event.delta, 60);
  document.querySelector("#mm").textContent = digits(minutes, 2);
});`,
    states: [
      { name: "hours", initial: 12 },
      { name: "minutes", initial: 0 },
      { name: "blink", initial: 0 },
    ],
    handlers: [
      { id: "host.rpc:0xB250", selector: "host.rpc:0xB250", body: `time feed` },
      { id: "tick.1s", selector: "tick.1s", body: `colon blink + heartbeat` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `minute trim` },
    ],
    targets: [
      { id: "hh", writes: ["textContent"] },
      { id: "mm", writes: ["textContent"] },
      { id: "colon", writes: ["textContent", "hidden"] },
    ],
  },

  focusTimer: {
    name: "Focus timer",
    rootClass: "focus-v3",
    html: `<div class="focus-v3" aria-label="Focus timer">
  <span class="focus-title">FOCUS</span>
  <span id="state" class="state-paused">PAUSED</span>
  <div class="focus-clock"><b id="min">25</b><i>:</i><b id="sec">00</b></div>
  <span class="focus-hint">KEY START/PAUSE \u00b7 KNOB \u00b11 MIN</span>
  <span class="focus-sub">CHORD RESETS TO 25:00</span>
</div>`,
    css: `.focus-v3{position:relative;width:100px;height:310px;overflow:hidden;background:#0b0a12;color:#e8eaf0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.focus-title{position:absolute;left:0;right:0;top:44px;text-align:center;font:700 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#ff5f97}
#state{position:absolute;left:12px;width:76px;top:92px;height:18px;border-radius:9px;text-align:center;font:700 9px/18px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px}
#state.state-paused{background:#2a2333;color:#a99cc0}
#state.state-running{background:#ff5f97;color:#1c0511}
.focus-clock{position:absolute;left:0;right:0;top:146px;display:flex;align-items:center;justify-content:center}
.focus-clock b{display:block;width:26px;height:30px;text-align:center;font:700 24px/30px ui-monospace,SFMono-Regular,Menlo,monospace;color:#f5f7fa}
.focus-clock i{display:block;width:8px;height:30px;text-align:center;font:700 20px/28px ui-monospace,SFMono-Regular,Menlo,monospace;color:#ff5f97;font-style:normal}
.focus-hint{position:absolute;left:6px;right:6px;top:242px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#4a5468}
.focus-sub{position:absolute;left:6px;right:6px;top:258px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#39404f}`,
    // A real pomodoro in the v3 DSL. There is no if-statement in the subset:
    // the countdown subtracts the running flag itself (total - running), and
    // the badge drives className + textContent from ONE pick index so the
    // assembler proves the lockstep and captures each state as pixels.
    script: `var total = 1500;
var running = 0;

widget.on("input.key.down", function (event) {
  running = mod(running + 1, 2);
  document.querySelector("#state").className = pick(running, "state-paused", "state-running");
  document.querySelector("#state").textContent = pick(running, "PAUSED", "FOCUS");
});

widget.on("tick.1s", function (event) {
  total = clamp(total - running, 0, 5940);
  document.querySelector("#min").textContent = digits((total / 60) | 0, 2);
  document.querySelector("#sec").textContent = digits(mod(total, 60), 2);
});

widget.on("input.fn-bottom-knob", function (event) {
  total = clamp(total + event.delta * 60, 0, 5940);
  document.querySelector("#min").textContent = digits((total / 60) | 0, 2);
  document.querySelector("#sec").textContent = digits(mod(total, 60), 2);
});

widget.on("input.chord.down", function (event) {
  running = 0;
  total = 1500;
  document.querySelector("#state").className = pick(running, "state-paused", "state-running");
  document.querySelector("#state").textContent = pick(running, "PAUSED", "FOCUS");
  document.querySelector("#min").textContent = digits((total / 60) | 0, 2);
  document.querySelector("#sec").textContent = digits(mod(total, 60), 2);
});`,
    states: [
      { name: "total", initial: 1500 },
      { name: "running", initial: 0 },
    ],
    handlers: [
      { id: "input.key.down", selector: "input.key.down", body: `start/pause` },
      { id: "tick.1s", selector: "tick.1s", body: `countdown` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `\u00b11 minute` },
      { id: "input.chord.down", selector: "input.chord.down", body: `reset 25:00` },
    ],
    targets: [
      { id: "state", writes: ["textContent", "className"] },
      { id: "min", writes: ["textContent"] },
      { id: "sec", writes: ["textContent"] },
    ],
  },

  metronome: {
    name: "Metronome",
    rootClass: "metro-v3",
    html: `<div class="metro-v3" aria-label="Metronome">
  <span class="metro-title">TEMPO</span>
  <div class="metro-arc" aria-hidden="true"><i id="pendulum"></i></div>
  <div class="metro-bpm"><b id="bpm">120</b><span class="metro-unit">BPM</span></div>
  <span id="mode" class="mode-idle">READY</span>
  <span class="metro-hint">KNOB SETS TEMPO \u00b7 KEY TOGGLES</span>
</div>`,
    css: `.metro-v3{position:relative;width:100px;height:310px;overflow:hidden;background:#0c1210;color:#e8eaf0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.metro-title{position:absolute;left:0;right:0;top:40px;text-align:center;font:700 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:5px;color:#2ec27e}
.metro-arc{position:absolute;left:28px;top:78px;width:44px;height:44px}
#pendulum{position:absolute;left:20px;top:0;width:4px;height:38px;border-radius:2px;background:#2ec27e;transform-origin:50% 4px;animation:metro-swing .8s ease-in-out infinite alternate}
#pendulum::after{content:"";position:absolute;left:-4px;bottom:0;width:12px;height:12px;border-radius:50%;background:#eafff4}
@keyframes metro-swing{from{transform:rotate(-38deg)}to{transform:rotate(38deg)}}
.metro-bpm{position:absolute;left:0;right:0;top:152px;display:flex;align-items:baseline;justify-content:center;gap:5px}
#bpm{display:block;width:42px;height:22px;text-align:center;font:700 20px/22px ui-monospace,SFMono-Regular,Menlo,monospace;color:#f5f7fa}
.metro-unit{font:700 9px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#77839a}
#mode{position:absolute;left:14px;width:72px;top:206px;height:16px;border-radius:8px;text-align:center;font:700 8px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px}
#mode.mode-idle{background:#1c2a24;color:#7da895}
#mode.mode-live{background:#2ec27e;color:#06130d}
.metro-hint{position:absolute;left:6px;right:6px;top:258px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#4a5468}`,
    // widget.animate() samples the REAL CSS keyframe animation into an
    // 8-frame 10fps flipbook the device plays back - the pendulum on the
    // keyboard is the same pixels the browser renders here.
    script: `var bpm = 120;
var running = 0;

widget.animate("#pendulum", 8);

widget.on("input.fn-bottom-knob", function (event) {
  bpm = clamp(bpm + event.delta, 40, 240);
  document.querySelector("#bpm").textContent = digits(bpm, 3);
});

widget.on("input.key.down", function (event) {
  running = mod(running + 1, 2);
  document.querySelector("#mode").className = pick(running, "mode-idle", "mode-live");
  document.querySelector("#mode").textContent = pick(running, "READY", "LIVE");
});

widget.on("tick.1s", function (event) {
  document.querySelector("#bpm").textContent = digits(bpm, 3);
});`,
    states: [
      { name: "bpm", initial: 120 },
      { name: "running", initial: 0 },
    ],
    handlers: [
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `tempo` },
      { id: "input.key.down", selector: "input.key.down", body: `start/stop` },
      { id: "tick.1s", selector: "tick.1s", body: `heartbeat publish` },
    ],
    targets: [
      { id: "pendulum", writes: ["animation"] },
      { id: "bpm", writes: ["textContent"] },
      { id: "mode", writes: ["textContent", "className"] },
    ],
  },

  weatherDevice: {
    name: "Weather (device DSL)",
    rootClass: "weather-v2",
    html: `<div class="weather-v2" aria-label="Weather">
  <div id="mark" class="mark-cloud" aria-hidden="true"><i></i><b></b></div>
  <span class="weather-location">ZIP 98304</span>
  <span class="weather-title">Today</span>
  <div class="weather-current"><strong><span id="temp-num">72</span><span class="deg">\u00b0</span></strong><span id="condition">Cloudy</span></div>
  <div class="weather-forecast">
    <div class="weather-day"><span id="day-1">Mon</span><b id="low-1">00</b><i>\u2192</i><b id="high-1">00</b></div>
    <div class="weather-day"><span id="day-2">Tue</span><b id="low-2">00</b><i>\u2192</i><b id="high-2">00</b></div>
  </div>
</div>`,
    css: `.weather-v2{position:relative;width:100px;height:310px;overflow:hidden;background:#000;color:#f5f5f4;font-family:"HKNova",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
#mark{position:absolute;left:38px;top:15px;width:24px;height:17px}
#mark i,#mark b{position:absolute;display:block}
.mark-sun i{display:none}
.mark-sun b{left:5px;top:1px;width:14px;height:14px;border-radius:50%;background:#ffd166}
.mark-cloud i{left:0;bottom:1px;width:24px;height:11px;border-radius:6px;background:#f5f5f4}
.mark-cloud b{right:3px;top:0;width:11px;height:11px;border-radius:50%;background:#f5f5f4}
.mark-rain i{left:0;top:1px;width:24px;height:9px;border-radius:5px;background:#9db4c0}
.mark-rain b{left:4px;bottom:0;width:2px;height:4px;background:#4ea8de;box-shadow:7px 0 0 #4ea8de,14px 0 0 #4ea8de}
.mark-wind i{left:0;top:4px;width:24px;height:3px;border-radius:2px;background:#f5f5f4}
.mark-wind b{left:4px;top:10px;width:16px;height:3px;border-radius:2px;background:#77736f}
.weather-location{position:absolute;left:8px;right:8px;top:39px;height:12px;color:#8c8782;text-align:center;font:600 7px/12px "HKNova",ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden}
.weather-title{position:absolute;left:8px;right:8px;top:57px;height:30px;text-align:center;font:500 22px/30px "HKNova",ui-sans-serif,system-ui,sans-serif}
.weather-current{position:absolute;box-sizing:border-box;left:8px;top:99px;width:84px;height:74px;border-radius:10px;background:#ff8a00;color:#090909;text-align:center;display:flex;flex-direction:column;justify-content:center}
.weather-current strong{display:block;font:500 26px/28px "HKNova",ui-sans-serif,system-ui,sans-serif}
#temp-num{display:inline-block;width:40px;height:28px;text-align:center;vertical-align:top}
.weather-current .deg{display:inline-block;vertical-align:top}
#condition{display:block;width:56px;height:16px;margin:2px auto 0;font:600 12px/16px "HKNova",ui-sans-serif,system-ui,sans-serif}
.weather-forecast{position:absolute;left:8px;top:198px;width:84px;height:76px;display:grid;grid-template-rows:repeat(2,38px)}
.weather-day{display:grid;grid-template-columns:26px 20px 12px 20px;align-items:center;width:84px;height:38px;color:#f5f5f4;font:600 11px/14px ui-monospace,SFMono-Regular,Menlo,monospace}
.weather-day span{text-align:left;height:14px;width:26px}
.weather-day b{font:inherit;text-align:center;height:14px;width:18px;justify-self:center}
.weather-day i{font:600 15px/14px ui-monospace,SFMono-Regular,Menlo,monospace;height:14px;text-align:center;font-style:normal;color:#ff8a00}`,
    // The Weather example's visuals in the device DSL, fed with LIVE data over
    // host.rpc (feed protocol below). Every dynamic region is a v3 raster
    // record: the temperature and forecast highs/lows are shared-slot digits()
    // targets (one mailbox slot per number, formatter-13 divisors extract the
    // display digits on-device), the condition mark is a class-variant CSS
    // drawing (sun/cloud/rain/wind), and weekday names are 7-variant picks.
    //   0xB241  value=temp \u00b0F (0..99)     auxiliary=condition 0..3
    //   0xB242  value=day-1 weekday 0..6   auxiliary=high*100+low
    //   0xB243  value=day-2 weekday 0..6   auxiliary=high*100+low
    // The knob nudges the displayed temperature for a hands-on demo, and a
    // 1 Hz heartbeat republishes it so the widget paints from the first
    // second after boot (the facade only draws after a publication).
    script: `var temp = 72;
var cond = 0;

widget.on("input.fn-bottom-knob", function (event) {
  temp = clamp(temp + event.delta, 0, 99);
  document.querySelector("#temp-num").textContent = digits(temp, 2);
});

widget.on("host.rpc:0xB241", function (event) {
  temp = clamp(event.value, 0, 99);
  cond = mod(event.auxiliary, 4);
  document.querySelector("#temp-num").textContent = digits(temp, 2);
  document.querySelector("#condition").textContent = pick(cond, "Clear", "Cloudy", "Rain", "Windy");
  document.querySelector("#mark").className = pick(cond, "mark-sun", "mark-cloud", "mark-rain", "mark-wind");
});

widget.on("host.rpc:0xB242", function (event) {
  document.querySelector("#day-1").textContent = pick(mod(event.value, 7), "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun");
  document.querySelector("#high-1").textContent = digits((event.auxiliary / 100) | 0, 2);
  document.querySelector("#low-1").textContent = digits(mod(event.auxiliary, 100), 2);
});

widget.on("host.rpc:0xB243", function (event) {
  document.querySelector("#day-2").textContent = pick(mod(event.value, 7), "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun");
  document.querySelector("#high-2").textContent = digits((event.auxiliary / 100) | 0, 2);
  document.querySelector("#low-2").textContent = digits(mod(event.auxiliary, 100), 2);
});

widget.on("tick.1s", function (event) {
  document.querySelector("#temp-num").textContent = digits(temp, 2);
});`,
    states: [
      { name: "temp", initial: 72 },
      { name: "cond", initial: 0 },
    ],
    handlers: [
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `temp nudge` },
      { id: "host.rpc:0xB241", selector: "host.rpc:0xB241", body: `temp + condition + mark` },
      { id: "host.rpc:0xB242", selector: "host.rpc:0xB242", body: `day-1 forecast` },
      { id: "host.rpc:0xB243", selector: "host.rpc:0xB243", body: `day-2 forecast` },
      { id: "tick.1s", selector: "tick.1s", body: `heartbeat publish` },
    ],
    targets: [
      { id: "temp-num", writes: ["textContent"] },
      { id: "condition", writes: ["textContent"] },
      { id: "mark", writes: ["className"] },
      { id: "day-1", writes: ["textContent"] },
      { id: "day-2", writes: ["textContent"] },
      { id: "low-1", writes: ["textContent"] },
      { id: "high-1", writes: ["textContent"] },
      { id: "low-2", writes: ["textContent"] },
      { id: "high-2", writes: ["textContent"] },
    ],
  },

  eventLab: {
    name: "Event lab",
    rootClass: "evlab-v3",
    html: `<div class="evlab-v3" aria-label="Event lab">
  <span class="ev-title">EVENT LAB</span>
  <div class="ev-row" style="top:58px"><span class="ev-name">100MS</span><b id="t100">00</b></div>
  <div class="ev-row" style="top:80px"><span class="ev-name">1S</span><b id="t1s">00</b></div>
  <div class="ev-row ev-in" style="top:110px"><span class="ev-name">KNOB</span><b id="knob">50</b></div>
  <div class="ev-row ev-in" style="top:132px"><span class="ev-name">KEY \u2193</span><b id="keyd">0</b></div>
  <div class="ev-row ev-in" style="top:154px"><span class="ev-name">KEY \u2191</span><b id="keyu">0</b></div>
  <div class="ev-row ev-in" style="top:176px"><span class="ev-name">HOLD</span><b id="hold">0</b></div>
  <div class="ev-row ev-in" style="top:198px"><span class="ev-name">CHORD \u2193</span><b id="chd">0</b></div>
  <div class="ev-row ev-in" style="top:220px"><span class="ev-name">CHORD \u2191</span><b id="chu">0</b></div>
  <div class="ev-row ev-host" style="top:250px"><span class="ev-name">WPM</span><b id="rpc">000</b></div>
  <span class="ev-hint">WPM = DEVICE FEED, NO HOST</span>
</div>`,
    css: `.evlab-v3{position:relative;width:100px;height:310px;overflow:hidden;background:#080b12;color:#e8eaf0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.ev-title{position:absolute;left:0;right:0;top:24px;text-align:center;font:700 11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:3px;color:#c792ea}
.ev-row{position:absolute;left:10px;right:10px;height:16px;display:flex;align-items:center;justify-content:space-between}
.ev-name{font:600 8px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#77839a}
.ev-row b{width:26px;height:16px;text-align:right;font:700 11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:#f5f7fa;font-style:normal}
.ev-in b{color:#59e2ff}
.ev-host b{color:#ffb74d}
.ev-hint{position:absolute;left:6px;right:6px;top:280px;text-align:center;font:600 7px/10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;color:#4a5468}`,
    // The diagnostics preset: EVERY device event kind, one counter each. If a
    // row moves, that event verifiably reaches your widget on this firmware -
    // ticks prove the heartbeat path, the input rows prove keys/chords/knob,
    // and the WPM row subscribes to the device's own typing-speed feed by
    // NAME - no hex id anywhere - so it shows live words/min with no host.
    // Digit widths are a budget, not a style: the facade renders 15 records
    // and every digit cell is one, so 2+2+2 (ticks+knob) + 5x1 (keys/chords)
    // + 3 (rpc) = 14 uses the whole allowance with the root target.
    script: `widget.keys("space", "shift", "any");

var t100 = 0;
var t1s = 0;
var knob = 50;
var keyd = 0;
var keyu = 0;
var hold = 0;
var chd = 0;
var chu = 0;
var rpc = 0;

widget.on("tick.100ms", function (event) {
  t100 = mod(t100 + 1, 100);
  document.querySelector("#t100").textContent = digits(t100, 2);
});

widget.on("tick.1s", function (event) {
  t1s = mod(t1s + 1, 100);
  document.querySelector("#t1s").textContent = digits(t1s, 2);
});

widget.on("input.fn-bottom-knob", function (event) {
  knob = clamp(knob + event.delta, 0, 99);
  document.querySelector("#knob").textContent = digits(knob, 2);
});

widget.on("input.key.down", function (event) {
  keyd = mod(keyd + 1, 10);
  document.querySelector("#keyd").textContent = digits(keyd, 1);
});

widget.on("input.key.up", function (event) {
  keyu = mod(keyu + 1, 10);
  document.querySelector("#keyu").textContent = digits(keyu, 1);
});

widget.on("input.key.hold", function (event) {
  hold = mod(hold + 1, 10);
  document.querySelector("#hold").textContent = digits(hold, 1);
});

widget.on("input.chord.down", function (event) {
  chd = mod(chd + 1, 10);
  document.querySelector("#chd").textContent = digits(chd, 1);
});

widget.on("input.chord.up", function (event) {
  chu = mod(chu + 1, 10);
  document.querySelector("#chu").textContent = digits(chu, 1);
});

widget.on("device.typing-speed", function (event) {
  rpc = mod(event.value, 1000);
  document.querySelector("#rpc").textContent = digits(rpc, 3);
});`,
    states: [
      { name: "t100", initial: 0 },
      { name: "t1s", initial: 0 },
      { name: "knob", initial: 50 },
      { name: "keyd", initial: 0 },
      { name: "keyu", initial: 0 },
      { name: "hold", initial: 0 },
      { name: "chd", initial: 0 },
      { name: "chu", initial: 0 },
      { name: "rpc", initial: 0 },
    ],
    handlers: [
      { id: "tick.100ms", selector: "tick.100ms", body: `100ms counter` },
      { id: "tick.1s", selector: "tick.1s", body: `1s counter + heartbeat` },
      { id: "input.fn-bottom-knob", selector: "input.fn-bottom-knob", body: `knob accumulator` },
      { id: "input.key.down", selector: "input.key.down", body: `key-down counter` },
      { id: "input.key.up", selector: "input.key.up", body: `key-up counter` },
      { id: "input.key.hold", selector: "input.key.hold", body: `hold counter` },
      { id: "input.chord.down", selector: "input.chord.down", body: `chord-down counter` },
      { id: "input.chord.up", selector: "input.chord.up", body: `chord-up counter` },
      { id: "device.typing-speed", selector: "device.typing-speed", body: `live WPM (device feed)` },
    ],
    targets: [
      { id: "t100", writes: ["textContent"] },
      { id: "t1s", writes: ["textContent"] },
      { id: "knob", writes: ["textContent"] },
      { id: "keyd", writes: ["textContent"] },
      { id: "keyu", writes: ["textContent"] },
      { id: "hold", writes: ["textContent"] },
      { id: "chd", writes: ["textContent"] },
      { id: "chu", writes: ["textContent"] },
      { id: "rpc", writes: ["textContent"] },
    ],
  },

};

export const PRESET_ORDER: { id: keyof typeof PRESETS; label: string; tagline: string }[] = [
  { id: "counter", label: "TALLY", tagline: "Start here: keys, chords, the Fn knob and live digits() - the hello-world of the device DSL" },
  { id: "clock", label: "CLOCK", tagline: "Host-fed time over host.rpc, a blinking colon via el.hidden, knob trims the minutes" },
  { id: "focusTimer", label: "FOCUS TIMER", tagline: "A real pomodoro: tick.1s countdown, lockstep class states, knob sets the duration" },
  { id: "metronome", label: "METRONOME", tagline: "widget.animate() samples the CSS pendulum into a device flipbook; digits + states" },
  { id: "weatherDevice", label: "WEATHER", tagline: "Live open-meteo data end-to-end: shared-slot digits, condition marks, two forecast rows" },
  { id: "eventLab", label: "EVENT LAB", tagline: "Every event kind with its own counter - push it to PROVE ticks, keys, chords, knob and host RPC reach your device" },
];
