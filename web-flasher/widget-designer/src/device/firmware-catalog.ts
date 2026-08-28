// ─────────────────────────────────────────────────────────────────────────────
// Known Framer F1 firmware app images, keyed by their SHA-256. These are the
// exact app-region bytes written at 0x10000 by the web-flasher. Reading the
// app region from flash and hashing it against this catalog is the definitive
// way to identify which firmware is on the device.
//
// Sources: web-flasher/src/data/firmware.js + the build manifests under
// f1-widget-sdk/build/*/.
// ─────────────────────────────────────────────────────────────────────────────

export interface FirmwareEntry {
  id: string;
  name: string;
  /** App-region byte count (the exact image size written at 0x10000). */
  bytes: number;
  /** SHA-256 of the app image. */
  sha256: string;
  /** Whether this build carries the MicroQuickJS module (screen 28). */
  hasMquickjs: boolean;
  /** Screen IDs this build registers. */
  screenIds: number[];
}

export const APP_REGION_ADDRESS = 0x10000;
export const MAX_APP_BYTES = 2_062_912;

export const FIRMWARE_CATALOG: FirmwareEntry[] = [
  {
    id: "wpm-pet",
    name: "WPM Pet",
    bytes: 2_028_032,
    sha256: "0e20b00b046f34750e19141ea5b9cede2debc0e04f59038432b508eb4a8df5a6",
    hasMquickjs: false,
    screenIds: [7],
  },
  {
    id: "music",
    name: "Music",
    bytes: 2_032_368,
    sha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
    hasMquickjs: false,
    screenIds: [1, 7],
  },
  {
    id: "custom-html-css-preview",
    name: "Custom HTML / CSS Preview (renderer ID 26)",
    bytes: 2_062_912,
    sha256: "49cbf8801e3d86b20e0df21f41a2410b3e4d8547f8f64021ca6ed4bd85168840",
    hasMquickjs: false,
    screenIds: [1, 7, 26],
  },
  {
    id: "clock-timer",
    name: "Clock + Timer (render v2)",
    bytes: 2_062_912,
    sha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
    hasMquickjs: false,
    screenIds: [1, 7, 26, 27],
  },
  {
    id: "weather-mquickjs",
    name: "Weather (MicroQuickJS canary)",
    bytes: 2_062_912,
    sha256: "5413d4b8735b437048a731b231cd874ae7d261c218dce50710722a9d7e8565dd",
    hasMquickjs: true,
    screenIds: [1, 7, 26, 27, 28],
  },
  {
    id: "widget-designer-multi",
    name: "Widget Designer (multi-widget, smooth motion candidate)",
    bytes: 2_062_912,
    sha256: "2062c22f110c616e91ad5d3a7368fefd79eb10f24bc372b00f7c661f223c9649",
    hasMquickjs: true,
    screenIds: [1, 7, 26, 27, 28, 29, 30, 31],
  },
  {
    id: "input-lab-generic",
    name: "Input Lab custom widgets (render v2 generic)",
    bytes: 2_062_912,
    sha256: "4e045ec270462754e8415c1e2d30181f500791db9d55cbeb98b8650621a78d1d",
    hasMquickjs: false,
    screenIds: [1, 7, 26],
  },
];

export function identifyFirmware(sha256: string): FirmwareEntry | null {
  return FIRMWARE_CATALOG.find((f) => f.sha256 === sha256) ?? null;
}
