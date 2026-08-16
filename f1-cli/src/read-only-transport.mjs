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

export class ReadOnlyViolationError extends Error {
  constructor(method) {
    super(`Refusing non-read-only device method: ${method || "<missing>"}`);
    this.name = "ReadOnlyViolationError";
    this.method = method;
  }
}

export class ReadOnlyTransport {
  constructor(transport, { allowTransientBubble = false } = {}) {
    this.transport = transport;
    this.allowTransientBubble = allowTransientBubble;
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
    if (!isAuditedRead && !isAllowedBubble) {
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
