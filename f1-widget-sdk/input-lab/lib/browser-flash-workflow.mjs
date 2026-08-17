const SINGLE_DEVICE_IDENTITY_MODE = "single-device";

export function approveInputLabFlashIdentity(normalIdentity, singleDeviceConfirmed = false) {
  if (!normalIdentity?.mode) throw new Error("Normal-mode Framer identity is unavailable.");
  if (normalIdentity.mode !== SINGLE_DEVICE_IDENTITY_MODE) return normalIdentity;
  if (singleDeviceConfirmed !== true) {
    throw new Error("Confirm that exactly one Framer F1 / Knob F1 is connected before flashing.");
  }
  return Object.freeze({ ...normalIdentity, singleDeviceConfirmed: true });
}

export function createInputLabFlashWorkflow({
  loadFirmware,
  FramerHidClient,
  resolveFramerIdentity,
  requestBootloaderPort,
  flashAppOnly,
  waitForHealthyFramer,
} = {}) {
  for (const [name, implementation] of Object.entries({ loadFirmware, FramerHidClient,
    resolveFramerIdentity, requestBootloaderPort, flashAppOnly, waitForHealthyFramer })) {
    if (typeof implementation !== "function") throw new TypeError(`Missing Input Lab flash dependency: ${name}.`);
  }
  let flashInProgress = false;

  return Object.freeze({
    resolveIdentity(device) {
      if (!device) throw new Error("Connect the Framer over WebHID before flashing.");
      return resolveFramerIdentity(device);
    },

    async flash({ device, firmware, normalIdentity, singleDeviceConfirmed = false,
      onProgress = null, onLog = null } = {}) {
      if (flashInProgress) throw new Error("An Input Lab firmware flash is already in progress.");
      flashInProgress = true;
      try {
        if (!device) throw new Error("Connect the Framer over WebHID before flashing.");
        if (!firmware?.flashable) throw new Error("The renderer image is not smoke-approved.");
        const approvedIdentity = approveInputLabFlashIdentity(normalIdentity, singleDeviceConfirmed);
        const prepared = await loadFirmware(firmware);
        onLog?.(`Firmware SHA-256 verified: ${prepared.validation.digest}.`);

        const client = await new FramerHidClient(device).open();
        try {
          await client.verifyVersion();
          await client.enterBootloader();
        } finally {
          await client.close().catch(() => {});
        }

        const port = await requestBootloaderPort();
        // flashAppOnly is the sole owner of the WebSerial Transport and its
        // WritableStream writer for the complete bootloader transaction.
        const receipt = await flashAppOnly({ port, bytes: prepared.bytes,
          normalIdentity: approvedIdentity, onProgress, onLog });
        const health = await waitForHealthyFramer(approvedIdentity,
          { expectedMacAddress: receipt.macAddress });
        return Object.freeze({ receipt, health, prepared });
      } finally {
        flashInProgress = false;
      }
    },
  });
}
