import wpmPetUrl from "../../../custom-firmware/build/framer-0.4.1-stage3e34-wpm-pet-full-app.bin?url";
import musicUrl from "../../../f1-widget-sdk/build/combined-music-fast-gradient/framer-0.4.1-combined-music-id1-wpm-id7-app.bin?url";
import htmlCssPreviewUrl from "../../../f1-widget-sdk/build/combined-renderer-id26/framer-0.4.1-combined-music-id1-wpm-id7-renderer-id26-app.bin?url";
import rendererManifest from "../../../f1-widget-sdk/build/combined-renderer-id26/combined-renderer-id26-manifest.json";

const rendererApp = rendererManifest.outputs.app;
const rendererIsSmokeApproved =
  rendererManifest.status === "DEVICE_SMOKE_CANDIDATE" && rendererManifest.deployable === true;
const musicHostCompanion = Object.freeze({
  url: "./downloads/framer-f1-music-host-macos.zip",
  filename: "framer-f1-music-host-macos.zip",
  platform: "macOS",
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
    compilerUrl: "https://htmlcss-to-framerf1-widget.g-m.dev",
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
]);

export const defaultFirmwareId = "wpm-pet";
