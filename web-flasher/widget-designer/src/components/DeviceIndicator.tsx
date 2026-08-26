// The one device-connection indicator (§4.9): dot + 12px label + mono
// firmware suffix. Used by the status bar; the Device tab reuses it wherever
// connection state appears so the vocabulary never forks.
//
// Given `onOpenDeviceTab`, the pill is a real button: in a tool whose whole
// point is pushing to a keyboard, "Disconnected" is a door, not a verdict.

import type { DeviceState } from "../device/useDevice";
import { StatusDot, Tooltip, type StatusDotState } from "./ui";

function describe(device: DeviceState): {
  dot: StatusDotState;
  label: string;
  fw: string | null;
  tooltip: string;
  aria: string;
} {
  switch (device.phase) {
    case "connecting":
      return {
        dot: "busy", label: "Connecting…", fw: null,
        tooltip: "Connecting to the keyboard…",
        aria: "Device connecting — open Device tab",
      };
    case "identifying":
      return {
        dot: "busy", label: "Identifying…", fw: null,
        tooltip: "Identifying the connected keyboard…",
        aria: "Device identifying — open Device tab",
      };
    case "connected":
    case "ready": {
      const version = device.connected?.version ?? "";
      const fw = device.firmware?.name ?? (version ? `fw ${version}` : null);
      return {
        dot: "ok", label: "F1", fw,
        tooltip: "Keyboard connected — open Device tab",
        aria: `Device connected${fw ? ` (${fw})` : ""} — open Device tab`,
      };
    }
    case "error":
      return {
        dot: "error", label: "Error", fw: null,
        tooltip: device.error || "Device error — open Device tab",
        aria: "Device error — open Device tab",
      };
    case "idle":
    default:
      return {
        dot: "idle", label: "Disconnected", fw: null,
        tooltip: "No device connected — open the Device tab to connect",
        aria: "No device connected — open Device tab to connect",
      };
  }
}

export function DeviceIndicator({
  device,
  onOpenDeviceTab,
}: {
  device: DeviceState;
  /** When provided, the pill becomes a button that opens the Device tab. */
  onOpenDeviceTab?: () => void;
}) {
  const { dot, label, fw, tooltip, aria } = describe(device);
  const content = (
    <>
      <StatusDot state={dot} />
      <span>{label}</span>
      {fw && <span className="wd-statusbtn-fw">{fw}</span>}
    </>
  );
  if (!onOpenDeviceTab) {
    return (
      <Tooltip label={tooltip}>
        <span className="wd-statusitem">{content}</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={tooltip}>
      <button
        type="button"
        className="wd-statusbtn"
        aria-label={aria}
        onClick={onOpenDeviceTab}
      >
        {content}
      </button>
    </Tooltip>
  );
}
