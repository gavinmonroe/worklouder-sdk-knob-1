import rendererAppUrl from "../../build/combined-renderer-id26/framer-0.4.1-combined-music-id1-wpm-id7-renderer-id26-app.bin?url";
import rendererCatalog from "../assets/renderer-flash-catalog.json";
import { loadFirmware } from "../../../web-flasher/src/lib/firmware.js";
import { FramerHidClient, resolveFramerIdentity,
  waitForHealthyFramer } from "../../../web-flasher/src/lib/framer-hid.js";
import { flashAppOnly, requestBootloaderPort } from "../../../web-flasher/src/lib/flasher.js";
import { createInputLabFlashWorkflow } from "./browser-flash-workflow.mjs";

const workflow = createInputLabFlashWorkflow({ loadFirmware, FramerHidClient, resolveFramerIdentity,
  requestBootloaderPort, flashAppOnly, waitForHealthyFramer });

export function resolveInputLabFlashIdentity(device) {
  return workflow.resolveIdentity(device);
}

export async function flashInputLabRenderer({ device, normalIdentity, singleDeviceConfirmed = false,
  onProgress = null, onLog = null } = {}) {
  if (!device) throw new Error("Connect the Framer over WebHID before flashing.");
  if (!navigator.serial) throw new Error("Firmware flashing requires WebSerial in desktop Chrome or Edge.");
  const approved = rendererCatalog.format === "framer-input-lab-public-flash-catalog-v1" &&
    rendererCatalog.status === "DEVICE_SMOKE_CANDIDATE" && rendererCatalog.deployable === true;
  const firmware = { id: "custom-html-css-preview", name: "Custom HTML / CSS Preview",
    url: rendererAppUrl, bytes: rendererCatalog.app.bytes, sha256: rendererCatalog.app.sha256,
    flashable: approved };
  const { receipt, health } = await workflow.flash({ device, firmware, normalIdentity,
    singleDeviceConfirmed, onProgress, onLog });
  return Object.freeze({ status: "WEB_SERIAL_APP_FLASH_COMPLETE", firmware: firmware.id,
    app: { bytes: firmware.bytes, sha256: firmware.sha256, offset: "0x10000" }, write: {
      baud: receipt.baud, appOnly: true, eraseAll: false, hashVerifiedByDevice: receipt.hashVerifiedByDevice },
    target: { chip: receipt.chipName, mac: receipt.macAddress, flashSize: receipt.flashSize,
      firmware: health.version }, postBootHealthy: true });
}
