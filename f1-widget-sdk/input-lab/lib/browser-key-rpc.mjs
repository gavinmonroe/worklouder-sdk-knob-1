import { parseRenderV2HostRpcId } from "./render-v2-browser.mjs";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export function isEditableKeyboardTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName ?? "").toUpperCase();
  return target.isContentEditable === true || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function normalizeKeyboardRpcConfig({ code, rpcId } = {}) {
  const normalizedCode = String(code ?? "").trim();
  invariant(/^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(normalizedCode),
    "KeyboardEvent.code must be 1..32 ASCII letters or digits and begin with a letter.");
  return Object.freeze({ code: normalizedCode, rpcId: parseRenderV2HostRpcId(rpcId) });
}

/**
 * A browser-only key-to-host-RPC level bridge. It never invents an on-device
 * input.key event: the configured key maps to one declared host RPC scalar.
 */
export class BrowserKeyRpcBridge {
  constructor({ element, documentTarget = globalThis.document, windowTarget = globalThis.window,
    getConfig, onEvent, onStatus = null } = {}) {
    invariant(element && typeof element.addEventListener === "function",
      "Browser key RPC bridge requires a focusable event target.");
    invariant(typeof getConfig === "function", "Browser key RPC bridge requires getConfig().");
    invariant(typeof onEvent === "function", "Browser key RPC bridge requires onEvent().");
    this.element = element;
    this.documentTarget = documentTarget;
    this.windowTarget = windowTarget;
    this.getConfig = getConfig;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.pressed = false;
    this.activeConfig = null;
    this.tail = Promise.resolve();
    this.destroyed = false;
    this.listeners = Object.freeze({
      keydown: (event) => this.handleKeyDown(event),
      keyup: (event) => this.handleKeyUp(event),
      blur: () => this.release("blur"),
      focusout: () => this.release("focusout"),
      visibilitychange: () => {
        if (this.documentTarget?.visibilityState === "hidden") this.release("hidden");
      },
      windowblur: () => this.release("window-blur"),
      pagehide: () => this.release("pagehide"),
    });
    element.addEventListener("keydown", this.listeners.keydown);
    element.addEventListener("keyup", this.listeners.keyup);
    element.addEventListener("blur", this.listeners.blur);
    element.addEventListener("focusout", this.listeners.focusout);
    documentTarget?.addEventListener?.("visibilitychange", this.listeners.visibilitychange);
    windowTarget?.addEventListener?.("blur", this.listeners.windowblur);
    windowTarget?.addEventListener?.("pagehide", this.listeners.pagehide);
  }

  enqueue(config, value, reason, synthetic = false) {
    const payload = Object.freeze({ kind: "host.rpc", id: config.rpcId, value, code: config.code,
      phase: value === 1 ? "down" : "up", reason, synthetic });
    const invoke = async () => {
      this.onStatus?.(payload);
      return this.onEvent(payload);
    };
    this.tail = this.tail.then(invoke, invoke);
    return this.tail;
  }

  handleKeyDown(event) {
    if (this.destroyed || event?.isComposing === true || event?.repeat === true ||
        isEditableKeyboardTarget(event?.target)) return false;
    let config;
    try { config = normalizeKeyboardRpcConfig(this.getConfig()); }
    catch (error) { this.onStatus?.(Object.freeze({ error, phase: "invalid" })); return false; }
    if (event?.code !== config.code || this.pressed) return false;
    event.preventDefault?.();
    this.pressed = true;
    this.activeConfig = config;
    this.element.dataset.pressed = "true";
    this.enqueue(config, 1, "keydown");
    return true;
  }

  handleKeyUp(event) {
    if (this.destroyed || event?.isComposing === true || isEditableKeyboardTarget(event?.target) || !this.pressed) return false;
    const config = this.activeConfig;
    if (!config || event?.code !== config.code) return false;
    event.preventDefault?.();
    this.pressed = false;
    this.activeConfig = null;
    this.element.dataset.pressed = "false";
    this.enqueue(config, 0, "keyup");
    return true;
  }

  release(reason = "release") {
    if (!this.pressed || !this.activeConfig) return this.tail;
    const config = this.activeConfig;
    this.pressed = false;
    this.activeConfig = null;
    this.element.dataset.pressed = "false";
    return this.enqueue(config, 0, reason, true);
  }

  async destroy(reason = "disconnect") {
    if (this.destroyed) return this.tail;
    const released = this.release(reason);
    this.destroyed = true;
    this.element.removeEventListener("keydown", this.listeners.keydown);
    this.element.removeEventListener("keyup", this.listeners.keyup);
    this.element.removeEventListener("blur", this.listeners.blur);
    this.element.removeEventListener("focusout", this.listeners.focusout);
    this.documentTarget?.removeEventListener?.("visibilitychange", this.listeners.visibilitychange);
    this.windowTarget?.removeEventListener?.("blur", this.listeners.windowblur);
    this.windowTarget?.removeEventListener?.("pagehide", this.listeners.pagehide);
    await released;
  }
}
