const glyphs = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ";

export const DEFAULT_INPUT_LAB_HTML = `<div class="input-scene">${
  Array.from({ length: 75 }, (_, index) => `<span>${glyphs[index % glyphs.length]}</span>`).join("")
}</div>`;

export const DEFAULT_INPUT_LAB_CSS = `.input-scene {
  background-color: #121212;
  color: #d6d3d1;
}

.input-scene > span {
  color: #d6d3d1;
  animation: breathe 4s ease-in-out 0s infinite;
}

.input-scene > span:nth-child(3n) {
  color: #d97757;
  animation: breathe 3s ease-in-out 0.4s infinite;
}

@keyframes breathe {
  0% { color: rgba(214, 211, 209, 0.35); text-shadow: none; }
  50% { color: #fff7ed; text-shadow: 0 0 10px rgba(255, 247, 237, 0.55); }
  100% { color: rgba(214, 211, 209, 0.35); text-shadow: none; }
}`;

export const DEFAULT_SLOT_NAMES = Object.freeze(["Working", "Generating", "Electric"]);

export const REFERENCE_INPUT_LAB_CSS = `.input-scene {
  background-color: #080612;
  color: #e9d5ff;
}

.input-scene > span {
  color: #a78bfa;
  animation: pulse 2s ease-in-out 0s infinite;
}

.input-scene > span:nth-child(2n) {
  color: #f9a8d4;
  animation: pulse 1.6s ease-in-out 0.3s infinite;
}

@keyframes pulse {
  0% { color: rgba(167, 139, 250, 0.78); text-shadow: 0 0 4px rgba(167, 139, 250, 0.35); }
  50% { color: #fff7ed; text-shadow: 0 0 8px rgba(249, 168, 212, 0.8); }
  100% { color: rgba(167, 139, 250, 0.78); text-shadow: 0 0 4px rgba(167, 139, 250, 0.35); }
}`;

export const LEGACY_LESS_BETTER_HTML = `<div class="poster">
  <svg class="grain" viewBox="0 0 100 310" aria-hidden="true">
    <filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="7"/></filter>
    <rect width="100" height="310" filter="url(#noise)" opacity="0.18"/>
  </svg>
  <div class="orb"></div>
  <p>LESS<br>BUT<br>BETTER</p>
</div>`;

export const LEGACY_LESS_BETTER_CSS = `html, body { background: #151310; }
.poster { position: relative; width: 100px; height: 310px; overflow: hidden; background: #151310; color: #ede7dc; }
.orb { position: absolute; width: 128px; height: 128px; left: -14px; top: 70px; border-radius: 50%;
  background: radial-gradient(circle at 42% 38%, #d97757 0 12%, #8f3f2b 38%, #151310 72%);
  animation: breathe 2s ease-in-out infinite; }
.grain { position: absolute; inset: 0; width: 100%; height: 100%; mix-blend-mode: soft-light; }
p { position: absolute; left: 10px; bottom: 18px; margin: 0; font: 700 18px/0.92 ui-monospace, monospace; letter-spacing: -1px; }
@keyframes breathe { 50% { transform: scale(1.08); filter: saturate(1.18); } }`;

export const GENERATING_PERIMETER_HTML = `<div class="generating" aria-label="Generating">
  <span class="perimeter-trace"></span>
  <span class="perimeter-trace perimeter-trace-secondary"></span>
</div>`;

export const GENERATING_PERIMETER_CSS = `html, body { background: #151310; }
.generating { position: relative; width: 100px; height: 310px; overflow: hidden; background: #151310; }
.generating::before { content: ""; position: absolute; inset: 2px; border: 1px solid #3b332e; }
.perimeter-trace { position: absolute; width: 32px; height: 2px; background: #d97757;
  offset-path: path("M 2 2 H 98 V 308 H 2 Z"); offset-rotate: auto; animation: perimeter 2s linear infinite; }
.perimeter-trace-secondary { width: 12px; background: #ede7dc; opacity: 0.55; animation-delay: -1s; }
@keyframes perimeter { to { offset-distance: 100%; } }`;

export const DEFAULT_RASTER_SETTINGS = Object.freeze({ fps: 5, loopDurationMs: 2000, maxFrames: 10,
  maxBytes: 131072, interaction: "none" });
export const GENERATING_PERIMETER_SETTINGS = Object.freeze({ fps: 10, loopDurationMs: 2000, maxFrames: 20,
  maxBytes: 92000, interaction: "none" });
export const DEFAULT_RENDER_V2_EVENT_CONFIG = Object.freeze({ keyboardCode: "Space", keyboardRpcId: "0xB201" });

export const DEFAULT_INPUT_LAB_SLOTS = Object.freeze([
  Object.freeze({ id: 0, name: "Working", renderer: "v1", script: "", mode: "auto",
    html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS, settings: DEFAULT_RASTER_SETTINGS,
    eventConfig: DEFAULT_RENDER_V2_EVENT_CONFIG, compiled: null }),
  Object.freeze({ id: 1, name: "Generating", renderer: "v1", script: "", mode: "auto",
    html: GENERATING_PERIMETER_HTML, css: GENERATING_PERIMETER_CSS,
    settings: GENERATING_PERIMETER_SETTINGS, eventConfig: DEFAULT_RENDER_V2_EVENT_CONFIG, compiled: null }),
  Object.freeze({ id: 2, name: "Electric", renderer: "v1", script: "", mode: "auto",
    html: DEFAULT_INPUT_LAB_HTML, css: REFERENCE_INPUT_LAB_CSS, settings: DEFAULT_RASTER_SETTINGS,
    eventConfig: DEFAULT_RENDER_V2_EVENT_CONFIG, compiled: null }),
]);

export const DEFAULT_RENDER_V2_HTML = `<div class="render-v2">
  <span id="clock" data-glyphs="0123456789:">12:34:56</span>
  <span id="knob" data-glyphs="123">1</span>
  <span id="host" data-glyphs="0123456789">0</span>
  <span>V</span><span>2</span><span>E</span><span>V</span><span>E</span><span>N</span><span>T</span>
</div>`;

export const DEFAULT_RENDER_V2_CSS = `.render-v2 {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(5, 20px);
  grid-auto-rows: 20px;
  min-width: 100px;
  min-height: 310px;
  background-color: #050a17;
  color: rgba(89, 226, 255, 1);
  font-size: 12px;
  font-family: "Courier New", Courier, monospace;
  justify-content: center;
  align-content: center;
}

.render-v2 > span {
  color: rgba(89, 226, 255, 1);
  text-shadow: 0 0 2px rgba(89, 226, 255, 0.5);
  text-align: center;
  user-select: none;
  line-height: 1;
}`;

export const DEFAULT_RENDER_V2_SCRIPT = `var secondsOfDay = 45296;
var knobVariant = 0;
var hostValue = 0;

widget.on("tick.1s", function (event) {
  secondsOfDay += 1;
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
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9");
  document.querySelector("#host").style.color = pick(hostValue,
    "#59E2FF", "#42DCE1", "#5BE89E", "#8FE16C", "#D3D54E",
    "#FFB74D", "#FF875B", "#FF5F97", "#DE5BE2", "#BB6AFF");
});`;
