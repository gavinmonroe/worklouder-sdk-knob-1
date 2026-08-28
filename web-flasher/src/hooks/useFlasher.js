import { useCallback, useMemo, useRef, useState } from "react";

import { defaultFirmwareId, firmwareCatalog } from "../data/firmware.js";
import { framerLayout, framerModelName } from "../lib/device-identity.js";
import { formatRegionAddress, loadFlashPlan } from "../lib/firmware.js";
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
  flashRegions,
  requestBootloaderPort,
} from "../lib/flasher.js";
import { loadScenePackage, pushScenePackageOverHid } from "../lib/scene-push.js";

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
      ? "The bootloader serial stream became locked after the flash write began. Keep the keyboard connected and retry the same build to complete recovery."
      : "The bootloader serial stream was locked before the flash write began. The existing firmware was not changed; use Exit bootloader without writing or power-cycle the keyboard.";
  }
  return error instanceof Error ? error.message : String(error);
}

function sceneErrorMessage(error) {
  if (error?.name === "NotFoundError") return "Device selection was cancelled.";
  if (
    ["NetworkError", "NotAllowedError"].includes(error?.name) ||
    /failed to open the device/iu.test(error?.message ?? "")
  ) {
    return "Chrome found the keyboard, but the operating system would not release its USB interface. Fully quit Work Louder Input and other flasher tabs, then try again.";
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
  const [scenePhase, setScenePhase] = useState("idle");
  const [sceneProgress, setSceneProgress] = useState(0);
  const [sceneError, setSceneError] = useState("");
  const [sceneResult, setSceneResult] = useState(null);
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
      appendLog(`Identified ${framerModelName(nextDevice.productId)} ${framerLayout(nextDevice.productId)} on firmware ${nextVersion}.`);
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
      const prepared = await loadFlashPlan(selected);
      preparedRef.current = { firmware: selected, ...prepared };
      if (prepared.multiRegion) {
        appendLog(`Verified ${prepared.regions.length} regions before any device access.`);
        for (const region of prepared.regions) {
          appendLog(
            `${region.label ?? region.kind} ${formatRegionAddress(region.address)} · ${region.bytes.length} bytes · SHA-256 ${region.sha256}.`,
          );
        }
      } else {
        appendLog(`Firmware SHA-256 verified: ${prepared.validation.digest}.`);
      }

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
      const onWriteStart = () => {
        appWriteStarted = true;
        setWriteStarted(true);
        setPhase("flashing");
      };
      const onProgress = (written, total) =>
        setProgress(total ? Math.round((written / total) * 100) : 0);
      let reportedRegion = null;
      const bootloaderIdentity = prepared.multiRegion
        ? await flashRegions({
          port,
          regions: prepared.regions,
          normalIdentity: { ...normalIdentity, singleDeviceConfirmed },
          onWriteStart: (plan) => {
            onWriteStart();
            appendLog(
              `Identity checks passed. Writing ${plan.length} verified regions in order: ${plan
                .map((region) => formatRegionAddress(region.address))
                .join(" → ")}.`,
            );
          },
          onProgress: (written, total, region) => {
            if (region && region.address !== reportedRegion) {
              reportedRegion = region.address;
              appendLog(`Writing ${region.label ?? region.kind} at ${formatRegionAddress(region.address)}…`);
            }
            onProgress(written, total);
          },
          onLog: appendLog,
        })
        : await flashAppOnly({
          port,
          bytes: prepared.bytes,
          sha256: selected.sha256,
          normalIdentity: { ...normalIdentity, singleDeviceConfirmed },
          onWriteStart: () => {
            onWriteStart();
            appendLog("Identity checks passed. Beginning the app-region write at 0x10000…");
          },
          onProgress,
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
          regions: bootloaderIdentity.regions.map((region) => ({
            address: formatRegionAddress(region.address),
            kind: region.kind,
            bytes: region.bytes,
            sha256: region.sha256,
          })),
        },
        write: {
          baud: bootloaderIdentity.baud,
          appOnly: !prepared.multiRegion,
          regionCount: bootloaderIdentity.regions.length,
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
      setDevice(health.device);
      setVersion(health.version);
      setScenePhase("idle");
      setSceneProgress(0);
      setSceneError("");
      setSceneResult(null);
      setPhase("complete");
      appendLog(`Flash complete. Framer returned healthy on firmware ${health.version}.`);
      if (selected.scenePackage) {
        appendLog(`${selected.scenePackage.name} is RAM-only; use "${selected.scenePackage.actionLabel}" to push it.`);
      }
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

  const enableScenePackage = useCallback(async () => {
    const scenePackage = selected.scenePackage;
    if (!scenePackage) return;
    setSceneError("");
    setSceneResult(null);
    setSceneProgress(0);
    setScenePhase("pushing");
    try {
      appendLog(`Loading and verifying ${scenePackage.name}…`);
      const bytes = await loadScenePackage(scenePackage);
      appendLog(`${scenePackage.name} SHA-256 verified: ${scenePackage.sha256}.`);
      const result = await pushScenePackageOverHid({
        device,
        bytes,
        package: scenePackage,
        onProgress: ({ stage, current, total }) => {
          if (stage === "uploading-chunks" && total) {
            setSceneProgress(Math.round((current / total) * 100));
          } else if (stage === "applying-on-keyboard") {
            setSceneProgress(100);
            setScenePhase("committing");
          }
        },
      });
      setSceneResult(result);
      setSceneProgress(100);
      setScenePhase("enabled");
      if (!device) setDevice(result.device);
      appendLog(
        result.alreadyEnabled
          ? `${result.status} · generation ${result.generation} · no push needed (${result.reason}).`
          : `${result.status} · generation ${result.generation} · ${result.chunks} chunks · ${result.bytes} bytes.`,
      );
    } catch (cause) {
      setScenePhase("scene-error");
      setSceneError(sceneErrorMessage(cause));
      appendLog(`Scene push stopped: ${sceneErrorMessage(cause)}`);
    }
  }, [appendLog, device, selected]);

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
    setScenePhase("idle");
    setSceneProgress(0);
    setSceneError("");
    setSceneResult(null);
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
    setScenePhase("idle");
    setSceneProgress(0);
    setSceneError("");
    setSceneResult(null);
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
    scene: {
      phase: scenePhase,
      progress: sceneProgress,
      error: sceneError,
      result: sceneResult,
      busy: ["pushing", "committing"].includes(scenePhase),
    },
    enableScenePackage,
    connectKeyboard,
    prepareBootloader,
    flash,
    exitBootloader,
    startOver,
  };
}
