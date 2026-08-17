import { useCallback, useMemo, useRef, useState } from "react";

import { defaultFirmwareId, firmwareCatalog } from "../data/firmware.js";
import { framerLayout } from "../lib/device-identity.js";
import { loadFirmware } from "../lib/firmware.js";
import {
  FramerHidClient,
  requestFramerHid,
  resolveFramerIdentity,
  waitForHealthyFramer,
} from "../lib/framer-hid.js";
import {
  browserCapabilities,
  browserIsSupported,
  exitBootloaderWithoutWrite,
  flashAppOnly,
  requestBootloaderPort,
} from "../lib/flasher.js";

const MAX_LOG_LINES = 240;

function errorMessage(error, { writeStarted = false } = {}) {
  if (error?.name === "NotFoundError") return "Device selection was cancelled.";
  if (
    ["NetworkError", "NotAllowedError"].includes(error?.name) ||
    /failed to open the device/iu.test(error?.message ?? "")
  ) {
    return "Chrome found the keyboard, but the operating system would not release its USB interface. Fully quit Work Louder Input and other flasher tabs, reconnect the keyboard, and try again.";
  }
  if (/WritableStream.*locked|Cannot create writer|already locked/iu.test(error?.message ?? "")) {
    return writeStarted
      ? "The bootloader serial stream became locked after the app write began. Keep the keyboard connected and retry the same binary to complete recovery."
      : "The bootloader serial stream was locked before the app write began. The existing firmware was not changed; use Exit bootloader without writing or power-cycle the keyboard.";
  }
  return error instanceof Error ? error.message : String(error);
}

export function useFlasher() {
  const capabilities = useMemo(() => browserCapabilities(), []);
  const supported = browserIsSupported(capabilities);
  const [selectedId, setSelectedId] = useState(defaultFirmwareId);
  const [device, setDevice] = useState(null);
  const [normalIdentity, setNormalIdentity] = useState(null);
  const [singleDeviceConfirmed, setSingleDeviceConfirmed] = useState(false);
  const [version, setVersion] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [bootloaderReady, setBootloaderReady] = useState(false);
  const [writeStarted, setWriteStarted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const preparedRef = useRef(null);
  const selected = firmwareCatalog.find((firmware) => firmware.id === selectedId) ?? firmwareCatalog[0];

  const appendLog = useCallback((line) => {
    if (!line) return;
    setLogs((current) => [...current, line].slice(-MAX_LOG_LINES));
  }, []);

  const identify = useCallback(async (existingDevice) => {
    setError("");
    setPhase("identifying");
    let client;
    try {
      const nextDevice = existingDevice ?? (await requestFramerHid());
      const nextIdentity = await resolveFramerIdentity(nextDevice);
      client = new FramerHidClient(nextDevice);
      await client.open();
      const nextVersion = await client.verifyVersion();
      setDevice(nextDevice);
      setNormalIdentity(nextIdentity);
      setSingleDeviceConfirmed(false);
      setVersion(nextVersion);
      setBootloaderReady(false);
      setWriteStarted(false);
      setPhase("identified");
      appendLog(`Identified Framer F1 ${framerLayout(nextDevice.productId)} on firmware ${nextVersion}.`);
      if (nextIdentity.mode === "single-device") {
        appendLog("Chrome did not expose the HID serial. Single-device confirmation is required before bootloader entry.");
      }
    } catch (cause) {
      setPhase("error");
      setError(errorMessage(cause));
    } finally {
      await client?.close().catch(() => {});
    }
  }, [appendLog]);

  const connectKeyboard = useCallback(() => identify(), [identify]);

  const prepareBootloader = useCallback(async () => {
    if (!device || !normalIdentity) return;
    if (normalIdentity?.mode === "single-device" && !singleDeviceConfirmed) {
      setError("Confirm that only one Framer F1 / Knob F1 is connected before entering the bootloader.");
      return;
    }
    if (!selected.flashable) {
      setError(selected.blockedReason ?? "This widget is not approved for device installation.");
      return;
    }
    setError("");
    setReceipt(null);
    setProgress(0);
    setLogs([]);
    setBootloaderReady(false);
    setWriteStarted(false);
    setPhase("preparing");
    try {
      appendLog(`Loading and validating ${selected.name}…`);
      const prepared = await loadFirmware(selected);
      preparedRef.current = { firmware: selected, ...prepared };
      appendLog(`Firmware SHA-256 verified: ${prepared.validation.digest}.`);

      const client = new FramerHidClient(device);
      await client.open();
      try {
        await client.verifyVersion();
        appendLog("Requesting the Framer bootloader over the vendor HID interface…");
        await client.enterBootloader();
      } finally {
        await client.close().catch(() => {});
      }
      setBootloaderReady(true);
      setPhase("bootloader-ready");
      appendLog("Bootloader requested. Select its new serial port in the next step.");
    } catch (cause) {
      setPhase("error");
      setError(errorMessage(cause));
    }
  }, [appendLog, device, normalIdentity, selected, singleDeviceConfirmed]);

  const flash = useCallback(async () => {
    const prepared = preparedRef.current;
    if (!selected.flashable) {
      setError(selected.blockedReason ?? "This widget is not approved for device installation.");
      return;
    }
    if (!device || !normalIdentity || !prepared || prepared.firmware.id !== selected.id) {
      setError("Prepare the selected firmware before opening the bootloader port.");
      return;
    }
    setError("");
    setWriteStarted(false);
    setPhase("selecting-port");
    let appWriteStarted = false;
    try {
      const port = await requestBootloaderPort();
      setPhase("checking-bootloader");
      appendLog("Serial bootloader selected. Checking chip, MAC, security state, and flash size…");
      const bootloaderIdentity = await flashAppOnly({
        port,
        bytes: prepared.bytes,
        normalIdentity: { ...normalIdentity, singleDeviceConfirmed },
        onWriteStart: () => {
          appWriteStarted = true;
          setWriteStarted(true);
          setPhase("flashing");
          appendLog("Identity checks passed. Beginning the app-region write at 0x10000…");
        },
        onProgress: (written, total) => setProgress(total ? Math.round((written / total) * 100) : 0),
        onLog: appendLog,
      });
      setProgress(100);
      setBootloaderReady(false);
      setPhase("verifying-boot");
      appendLog("Device MD5 matched. Waiting for the normal Framer HID interface…");
      const health = await waitForHealthyFramer(normalIdentity, {
        expectedMacAddress: bootloaderIdentity.macAddress,
      });
      const finishedAt = new Date().toISOString();
      const nextReceipt = {
        format: "framer-f1-web-deployment-receipt-v1",
        createdAt: finishedAt,
        target: {
          device: "knob_f1",
          layout: framerLayout(device.productId).toLowerCase(),
          firmware: health.version,
          serialNumber: normalIdentity.serialNumber,
          identityMode: normalIdentity.mode,
          mac: bootloaderIdentity.macAddress,
        },
        app: {
          id: selected.id,
          name: selected.name,
          bytes: selected.bytes,
          sha256: selected.sha256,
          flashOffset: "0x10000",
        },
        write: {
          baud: bootloaderIdentity.baud,
          appOnly: true,
          eraseAll: false,
          hashVerifiedByDevice: bootloaderIdentity.hashVerifiedByDevice,
        },
        identity: {
          chip: bootloaderIdentity.chipName,
          flashSize: bootloaderIdentity.flashSize,
          secureBoot: bootloaderIdentity.security.secureBoot,
          flashEncryption: bootloaderIdentity.security.flashEncryption,
        },
        postBoot: { healthy: true, firmware: health.version },
      };
      setReceipt(nextReceipt);
      setPhase("complete");
      appendLog(`Flash complete. Framer returned healthy on firmware ${health.version}.`);
    } catch (cause) {
      setPhase("error");
      setError(errorMessage(cause, { writeStarted: appWriteStarted }));
    }
  }, [appendLog, device, normalIdentity, selected, singleDeviceConfirmed]);

  const exitBootloader = useCallback(async () => {
    setError("");
    setPhase("recovering-bootloader");
    try {
      appendLog("Select the Framer bootloader serial port. This recovery action will not write flash.");
      const port = await requestBootloaderPort();
      const recoveryIdentity = normalIdentity
        ? { ...normalIdentity, singleDeviceConfirmed }
        : null;
      const recovered = await exitBootloaderWithoutWrite({
        port,
        normalIdentity: recoveryIdentity,
        onLog: appendLog,
      });

      preparedRef.current = null;
      setBootloaderReady(false);
      setWriteStarted(false);
      setProgress(0);
      setDevice(null);
      setVersion(null);
      appendLog("Reset requested. Waiting for the existing Framer app to return…");

      if (normalIdentity) {
        setPhase("verifying-boot");
        const health = await waitForHealthyFramer(normalIdentity, {
          expectedMacAddress: recovered.macAddress,
        });
        setDevice(health.device);
        setVersion(health.version);
        setPhase("identified");
        appendLog(`Existing app returned healthy on firmware ${health.version}.`);
      } else {
        setNormalIdentity(null);
        setPhase("idle");
        appendLog("Reset sent. Use Connect keyboard when the normal HID interface returns.");
      }
    } catch (cause) {
      setPhase("error");
      setError(errorMessage(cause));
    }
  }, [appendLog, normalIdentity, singleDeviceConfirmed]);

  const confirmSingleDevice = useCallback((confirmed) => {
    setSingleDeviceConfirmed(confirmed);
    setError("");
  }, []);

  const selectFirmware = useCallback((id) => {
    preparedRef.current = null;
    setSelectedId(id);
    setProgress(0);
    setReceipt(null);
    setError("");
    setBootloaderReady(false);
    setWriteStarted(false);
    if (device) setPhase("identified");
  }, [device]);

  const startOver = useCallback(() => {
    preparedRef.current = null;
    setDevice(null);
    setNormalIdentity(null);
    setSingleDeviceConfirmed(false);
    setVersion(null);
    setPhase("idle");
    setBootloaderReady(false);
    setWriteStarted(false);
    setProgress(0);
    setReceipt(null);
    setError("");
    setLogs([]);
  }, []);

  return {
    capabilities,
    supported,
    selected,
    selectedId,
    selectFirmware,
    device,
    normalIdentity,
    singleDeviceConfirmed,
    confirmSingleDevice,
    version,
    phase,
    bootloaderReady,
    canExitBootloader: phase === "error" && bootloaderReady && !writeStarted,
    progress,
    error,
    logs,
    receipt,
    connectKeyboard,
    prepareBootloader,
    flash,
    exitBootloader,
    startOver,
  };
}
