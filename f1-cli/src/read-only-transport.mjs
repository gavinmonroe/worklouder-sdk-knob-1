import { BUBBLE_METHOD, validateBubblePayload } from "./bubble.mjs";

/**
 * RPC methods audited as read-only in wl-device-kit 0.1.28.
 * Additions must be reviewed against the extracted SDK before being allowed.
 */
export const READ_ONLY_RPC_METHODS = Object.freeze(new Set([
  "sys.version",
  "device.status",
  "fs.list",
  "fs.read",
  "fs.readbin",
  "appmgr.list_active",
  "appmgr.list_installed",
  "ui.active_screen",
]));

export const READ_ONLY_LEGACY_METHODS = Object.freeze(new Set(["version"]));

/**
 * Read-only RPC methods that exist in Knob 1 firmware 0.4.1 but are absent from
 * wl-device-kit 0.1.28, so they cannot be audited the way READ_ONLY_RPC_METHODS is.
 * They are kept in a separate set, off by default, and reached only through the
 * explicit `probe` command -- widening the audited set with unaudited methods would
 * quietly weaken the guarantee that set is documented to make.
 *
 * Evidence is the firmware's own dispatch tables, read from a full-flash capture:
 *
 *   ui.wallpaper_list             beside offset/limit/total/items and
 *                                 "list too large, page it" -- a pager
 *   sentry.get                    beside uptime/uptime_ms/cpu_freq/heap_size/heap_free/
 *                                 heap_min_free/tasks/runtime/usage/priority/core/
 *                                 stack_min -- a diagnostics snapshot
 *   fs.chksm                      in the wl_fs.cpp table beside list/read/readbin,
 *                                 next to "Checking if file exists: %s"
 *   sys.charger_diagnostic_summary  own handler rpc_on_charger_diagnostic_summary
 *
 * Deliberately excluded, and why:
 *   sys.selftest, sys.charger_diagnostic  may actuate hardware; the latter takes a
 *                                         `category` such as power.max77972.register_dump
 *   sentry.crash, sentry.coredump_erase   trigger or destroy state
 *   sentry.coredump                       semantics unclear
 *   ui.wallpaper_select/_background,
 *   ui.home_accent_color                  change what the device displays
 *   fs.format/delete/write/writebin       destructive
 *   v.framer.hid                          unknown; no rpc_on_ handler symbol
 *   kb.*, alert.generic, mp.*             device-to-host notifications, not calls
 */
export const FIRMWARE_PROBE_METHODS = Object.freeze(new Set([
  "ui.wallpaper_list",
  "sentry.get",
  "fs.chksm",
  "sys.charger_diagnostic_summary",
]));

export class ReadOnlyViolationError extends Error {
  constructor(method) {
    super(`Refusing non-read-only device method: ${method || "<missing>"}`);
    this.name = "ReadOnlyViolationError";
    this.method = method;
  }
}

export class ReadOnlyTransport {
  constructor(transport, { allowTransientBubble = false, allowFirmwareProbes = false } = {}) {
    this.transport = transport;
    this.allowTransientBubble = allowTransientBubble;
    this.allowFirmwareProbes = allowFirmwareProbes;
  }

  async sendJsonRpcRequest(request, id) {
    let message;
    try {
      message = JSON.parse(request);
    } catch {
      throw new ReadOnlyViolationError("<invalid-json>");
    }

    const isAuditedRead = READ_ONLY_RPC_METHODS.has(message?.method);
    const isAllowedBubble = this.allowTransientBubble && message?.method === BUBBLE_METHOD;
    const isAllowedProbe = this.allowFirmwareProbes && FIRMWARE_PROBE_METHODS.has(message?.method);
    if (!isAuditedRead && !isAllowedBubble && !isAllowedProbe) {
      throw new ReadOnlyViolationError(message?.method);
    }
    if (isAllowedBubble) validateBubblePayload(message.params);

    return this.transport.sendJsonRpcRequest(request, id);
  }

  async sendLegacyRpcRequest(method, args) {
    if (!READ_ONLY_LEGACY_METHODS.has(method)) {
      throw new ReadOnlyViolationError(method);
    }
    return this.transport.sendLegacyRpcRequest(method, args);
  }

  abortJsonRpcRequest(id) {
    return this.transport.abortJsonRpcRequest?.(id);
  }

  addNotifyHandler() {
    throw new ReadOnlyViolationError("notify-handler");
  }

  removeNotifyHandler() {
    throw new ReadOnlyViolationError("notify-handler");
  }
}
