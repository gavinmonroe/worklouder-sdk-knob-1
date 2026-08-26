import wpmPetUrl from "../../../custom-firmware/build/framer-0.4.1-stage3e34-wpm-pet-full-app.bin?url";
import musicUrl from "../../../f1-widget-sdk/build/combined-music-fast-gradient/framer-0.4.1-combined-music-id1-wpm-id7-app.bin?url";
import htmlCssPreviewUrl from "../../../f1-widget-sdk/build/combined-renderer-id26/framer-0.4.1-combined-music-id1-wpm-id7-renderer-id26-app.bin?url";
import rendererManifest from "../../../f1-widget-sdk/build/combined-renderer-id26/combined-renderer-id26-manifest.json";
import clockTimerUrl from "../../../f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin?url";
import focusClockTimerPackageUrl from "../../../f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/focus-clock-timer.generation-2.package.bin?url";
import weatherAppUrl from "../../../experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/framer-0.4.1-mqjs-id28-weather-zip-persist-btp1-app.bin?url";
import weatherTextPageUrl from "../../../experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/mqjs-id28-text-page.bin?url";
import weatherRodataPageUrl from "../../../experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/mqjs-id28-rodata-page.bin?url";
import weatherSceneSlotBUrl from "../../../experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/scene-slot-b.bin?url";
import inputLabGenericUrl from "../../../f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin?url";
import inputLabGenericManifest from "../../../f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/combined-renderer-v2-generic-input-lab-manifest.json";

const rendererApp = rendererManifest.outputs.app;
const rendererIsSmokeApproved =
  rendererManifest.status === "DEVICE_SMOKE_CANDIDATE" && rendererManifest.deployable === true;

const inputLabGenericApp = inputLabGenericManifest.outputs.app;
const inputLabGenericIsSmokeApproved =
  inputLabGenericManifest.status === "DEVICE_SMOKE_CANDIDATE" && inputLabGenericManifest.deployable === true;

const INPUT_LAB_URL = "https://htmlcss-to-framerf1-widget.g-m.dev";

const musicHostCompanion = Object.freeze({
  url: "./downloads/framer-f1-music-host-macos.zip",
  filename: "framer-f1-music-host-macos.zip",
  platform: "macOS",
  title: "Music needs the Mac host companion",
  description:
    "Run it alongside Work Louder Input to send Apple Music or Chrome media to the keyboard.",
});

// Produced by the weather host companion packager; referenced, never imported,
// so a build still succeeds before that archive is generated.
const weatherHostCompanion = Object.freeze({
  url: "./downloads/framer-f1-weather-host-macos.zip",
  filename: "framer-f1-weather-host-macos.zip",
  platform: "macOS",
  title: "Weather needs the Mac host companion",
  description:
    "Requires macOS, Node.js 22+, and the Work Louder Input app. It feeds live weather to the keyboard and receives the ZIP code you edit with the knob. Music sync is included.",
});

// The clock + timer content is a RAM-only render-v2 scene package. The keyboard
// forgets it on every power cycle, so it is pushed over normal-mode WebHID
// rather than written to flash.
const focusClockTimerPackage = Object.freeze({
  id: "focus-clock-timer",
  name: "Clock + Timer scene package",
  url: focusClockTimerPackageUrl,
  bytes: 95_535,
  sha256: "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7",
  expectedGeneration: 1,
  generation: 2,
  chunks: 32,
  actionLabel: "Enable clock & timer",
  title: "Clock and timer must be pushed after every boot",
  description:
    "The orange focus clock and dark sky-blue timer live in RAM, not flash. Keep the keyboard on screen ID 26, then push the pinned 95,535-byte package over USB. Repeat this after every power cycle.",
});

// The Weather build (release 2026-08-18-id28-persist-btp1) persists whatever
// clock+timer package was last pushed into flash slot B (0x240000, written as
// a flash region alongside the app) and re-adopts it on every boot, so this
// push is a manual fallback for that card, not the primary path. It is the
// exact same RAM-only HID push as focusClockTimerPackage; only the button
// copy differs.
const weatherClockTimerFallbackPackage = Object.freeze({
  ...focusClockTimerPackage,
  actionLabel: "Push clock & timer again (normally not needed — firmware restores it at boot)",
  title: "Firmware restores the clock and timer at every boot",
  description:
    "This build persists the pushed clock+timer package to flash slot B (0x240000) and re-adopts it at every boot (boot-adopt + persist-on-push), live-verified on 2026-08-18. Clock and timer survive reboots and crashes with no host required. Use this action only as a manual fallback if the keyboard is ever missing them.",
});

export const firmwareCatalog = Object.freeze([
  Object.freeze({
    id: "wpm-pet",
    name: "WPM Pet",
    includes: Object.freeze(["WPM Pet"]),
    description: "Animated typing companion with six selectable pet species.",
    detail: "Screen ID 7",
    evidence: "Live accepted",
    flashable: true,
    url: wpmPetUrl,
    bytes: 2_028_032,
    sha256: "0e20b00b046f34750e19141ea5b9cede2debc0e04f59038432b508eb4a8df5a6",
    accent: "purple",
  }),
  Object.freeze({
    id: "music",
    name: "Music",
    includes: Object.freeze(["WPM Pet", "Music"]),
    description: "Live album art, title, artist, progress, and media state.",
    detail: "Music ID 1 · WPM ID 7",
    evidence: "Live accepted",
    flashable: true,
    url: musicUrl,
    bytes: 2_032_368,
    sha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
    accent: "orange",
    hostCompanion: musicHostCompanion,
  }),
  Object.freeze({
    id: "custom-html-css-preview",
    name: "Custom HTML / CSS Preview",
    includes: Object.freeze(["WPM Pet", "Music", "Custom HTML / CSS Preview"]),
    compilerUrl: INPUT_LAB_URL,
    description: "Compiled HTML/CSS scenes with an embedded three-slot startup preview.",
    detail: "Renderer ID 26 · Music ID 1 · WPM ID 7",
    evidence: rendererIsSmokeApproved ? "Smoke candidate" : "Preview only",
    evidenceTone: rendererIsSmokeApproved ? "caution" : "preview",
    flashable: rendererIsSmokeApproved,
    notice: rendererIsSmokeApproved
      ? "This exact image has a healthy app-only device receipt, but renderer visuals, repeated scene uploads, and heap stability are not yet live accepted."
      : null,
    blockedReason: rendererIsSmokeApproved
      ? null
      : "Device installation is disabled because the generated renderer manifest is not smoke-approved.",
    url: htmlCssPreviewUrl,
    bytes: rendererApp.bytes,
    sha256: rendererApp.sha256,
    accent: "yellow",
    hostCompanion: musicHostCompanion,
  }),
  Object.freeze({
    id: "clock-timer",
    name: "Clock + Timer (render v2)",
    includes: Object.freeze(["WPM Pet", "Music", "Clock", "Timer"]),
    description: "Orange focus clock and dark sky-blue timer on the render-v2 renderer.",
    detail: "Clock ID 26 · Timer ID 27 · Music ID 1 · WPM ID 7",
    evidence: "Live accepted",
    flashable: true,
    notice:
      "The clock and timer content is a RAM-only scene package. Flashing this image does not install it; use Enable clock & timer after every power cycle.",
    url: clockTimerUrl,
    bytes: 2_062_912,
    sha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
    accent: "blue",
    scenePackage: focusClockTimerPackage,
    hostCompanion: musicHostCompanion,
  }),
  Object.freeze({
    id: "weather-mquickjs",
    name: "Weather (MicroQuickJS canary)",
    includes: Object.freeze(["WPM Pet", "Music", "Clock", "Timer", "Weather"]),
    description:
      "Everything in Clock + Timer plus the MicroQuickJS weather screen with knob-edited ZIP settings.",
    detail: "Weather ID 28 · Clock ID 26 · Timer ID 27 · Music ID 1 · WPM ID 7",
    evidence: "Live tested canary",
    evidenceTone: "caution",
    flashable: true,
    notice:
      "Diag-track build (PSRAM VM heap, ZIP settings assets, telemetry pages, BT P1 diagnostic patch). It was live-tested on one unit on 2026-08-18 and did not go through the audited release pipeline. The firmware persists the pushed clock+timer render-v2 package to flash slot B (0x240000) and re-adopts it at every boot (boot-adopt + persist-on-push), live-verified on 2026-08-18, so clock and timer survive reboots and crashes with no host needed. It also includes a 5-byte Bluetooth reconnect patch (release_adv_hold); that does not fix the Mac reconnect issue yet and is still under investigation. Live weather and keyboard ZIP editing need the macOS host companion (Node.js 22+ and the Work Louder Input app). Includes everything from Clock + Timer.",
    // The persisted clock+timer scene slot first, then the two MicroQuickJS
    // module pages, then the app that loads them, written last.
    regions: Object.freeze([
      Object.freeze({
        address: 0x240000,
        kind: "page",
        label: "Clock + Timer scene slot B (persisted)",
        url: weatherSceneSlotBUrl,
        bytes: 95_599,
        sha256: "599be673ca9aba43a1fc64ec73324137919df70d9475ff8477100aa57cf0008f",
      }),
      Object.freeze({
        address: 0x210000,
        kind: "page",
        label: "MicroQuickJS text page",
        url: weatherTextPageUrl,
        bytes: 131_072,
        sha256: "f69859e052a8b209faea91ba57e332e5b0ef9698c2431ecf5bd9c832a7433477",
      }),
      Object.freeze({
        address: 0x230000,
        kind: "page",
        label: "MicroQuickJS rodata page",
        url: weatherRodataPageUrl,
        bytes: 65_536,
        sha256: "6a11369374da2d1ce51a62b7bc05ee517e15746feb97c8c5cb4d2c5f1178ede7",
      }),
      Object.freeze({
        address: 0x10000,
        kind: "app",
        label: "Weather app",
        url: weatherAppUrl,
        bytes: 2_062_912,
        sha256: "5413d4b8735b437048a731b231cd874ae7d261c218dce50710722a9d7e8565dd",
      }),
    ]),
    url: weatherAppUrl,
    bytes: 2_062_912,
    sha256: "5413d4b8735b437048a731b231cd874ae7d261c218dce50710722a9d7e8565dd",
    accent: "green",
    scenePackage: weatherClockTimerFallbackPackage,
    hostCompanion: weatherHostCompanion,
  }),
  Object.freeze({
    id: "input-lab-generic",
    name: "Input Lab custom widgets (render v2 generic)",
    includes: Object.freeze(["WPM Pet", "Music", "Input Lab custom widgets"]),
    compilerUrl: INPUT_LAB_URL,
    description:
      "Generic render-v2 screen that accepts compiled scene pushes from Input Lab.",
    detail: "Generic renderer ID 26 · Music ID 1 · WPM ID 7",
    evidence: inputLabGenericIsSmokeApproved ? "Smoke candidate" : "Preview only",
    evidenceTone: inputLabGenericIsSmokeApproved ? "caution" : "preview",
    flashable: inputLabGenericIsSmokeApproved,
    notice: inputLabGenericIsSmokeApproved
      ? "The clock, timer, and weather widgets are not in this image. Choose this build to push your own Input Lab widgets; choose Weather for the built-in set."
      : null,
    blockedReason: inputLabGenericIsSmokeApproved
      ? null
      : "Device installation is disabled because the generated generic renderer manifest is not smoke-approved.",
    url: inputLabGenericUrl,
    bytes: inputLabGenericApp.bytes,
    sha256: inputLabGenericApp.sha256,
    accent: "yellow",
    hostCompanion: musicHostCompanion,
  }),
]);

export const defaultFirmwareId = "wpm-pet";
