import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const SDK_ENTRY_URL = new URL(
  "../../extracted/input-app/node_modules/@worklouder/wl-device-kit/dist/index.js",
  import.meta.url,
);
export const SDK_PACKAGE_URL = new URL(
  "../../extracted/input-app/node_modules/@worklouder/wl-device-kit/package.json",
  import.meta.url,
);

export function loadExtractedSdk() {
  try {
    return require(fileURLToPath(SDK_ENTRY_URL));
  } catch (error) {
    const wrapped = new Error(
      "Could not load the extracted @worklouder/wl-device-kit. Keep f1-cli beside extracted/input-app and use the same CPU architecture as the Input app.",
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

export function getExtractedSdkMetadata() {
  try {
    const pkg = require(fileURLToPath(SDK_PACKAGE_URL));
    return { name: pkg.name, version: pkg.version, license: pkg.license };
  } catch (error) {
    const wrapped = new Error("Could not read the extracted SDK package metadata.");
    wrapped.cause = error;
    throw wrapped;
  }
}
