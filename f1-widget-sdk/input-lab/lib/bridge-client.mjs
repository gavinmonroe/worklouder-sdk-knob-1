export const INPUT_LAB_BRIDGE_PROTOCOL = "framer-f1-input-lab-bridge-v1";
export const DEFAULT_INPUT_LAB_BRIDGE_URL = "http://127.0.0.1:9231";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function locationUrl(value) {
  if (!value) return null;
  return new URL(typeof value === "object" && typeof value.href === "string" ? value.href : String(value));
}

export function defaultInputLabBridgeUrl(pageUrl = globalThis.location?.href) {
  const page = locationUrl(pageUrl);
  return page?.protocol === "https:" && !LOOPBACK_HOSTS.has(page.hostname)
    ? page.origin : DEFAULT_INPUT_LAB_BRIDGE_URL;
}

export function normalizeInputLabBridgeUrl(value, { pageUrl = globalThis.location?.href } = {}) {
  const page = locationUrl(pageUrl);
  const url = new URL(String(value ?? defaultInputLabBridgeUrl(page)));
  const hostedPage = page?.protocol === "https:" && !LOOPBACK_HOSTS.has(page.hostname);
  const loopback = !hostedPage && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  const hostedSameOrigin = hostedPage && url.protocol === "https:" && url.origin === page.origin;
  invariant(loopback || hostedSameOrigin,
    "Input Lab API URL must use HTTP on a loopback host or the hosted page's HTTPS origin.");
  invariant(!url.username && !url.password && !url.search && !url.hash,
    "Input Lab bridge URL cannot contain credentials, query text, or a fragment.");
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.href.replace(/\/$/u, "");
}

export function bridgeAllowsPush(capabilities) {
  return capabilities?.protocol === INPUT_LAB_BRIDGE_PROTOCOL && capabilities?.devicePush === true &&
    typeof capabilities?.sessionToken === "string" && /^[A-Za-z0-9_-]{43}$/u.test(capabilities.sessionToken);
}

export class InputLabBridgeClient {
  constructor({ baseUrl, pageUrl = globalThis.location?.href, fetchImpl = globalThis.fetch,
    timeoutMs = 1_500 } = {}) {
    invariant(typeof fetchImpl === "function", "Input Lab bridge client requires fetch().");
    invariant(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10_000,
      "Input Lab bridge timeout must be 100..10000ms.");
    this.baseUrl = normalizeInputLabBridgeUrl(baseUrl, { pageUrl });
    // Browser `window.fetch` must be invoked without rebinding `this` to the
    // client instance. Keep the injected function callable in both browsers
    // and Node-based tests.
    this.fetch = (...arguments_) => fetchImpl(...arguments_);
    this.credentials = locationUrl(pageUrl)?.origin === new URL(this.baseUrl).origin ? "same-origin" : "omit";
    this.timeoutMs = timeoutMs;
    this.capabilities = null;
  }

  async connect() {
    const response = await this.fetch(`${this.baseUrl}/api/bridge`, {
      method: "GET", mode: "cors", credentials: this.credentials, cache: "no-store",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    invariant(response.ok, `Input Lab bridge returned HTTP ${response.status}.`);
    const capabilities = await response.json();
    invariant(capabilities?.protocol === INPUT_LAB_BRIDGE_PROTOCOL &&
      /^[A-Za-z0-9_-]{43}$/u.test(capabilities.sessionToken ?? ""),
    "Input Lab bridge returned an invalid capability handshake.");
    this.capabilities = Object.freeze(capabilities);
    return this.capabilities;
  }

  async request(path, body, { accept = "application/json" } = {}) {
    invariant(this.capabilities, "Input Lab bridge is not connected.");
    invariant(/^\/api\/(?:compile|capture|bundle|render-v2\/(?:compile|simulate))$/u.test(path),
      "Unsupported Input Lab bridge endpoint.");
    return this.fetch(`${this.baseUrl}${path}`, { method: "POST", mode: "cors", credentials: this.credentials,
      headers: { accept, "content-type": "application/json",
        "x-input-lab-session": this.capabilities.sessionToken }, body: JSON.stringify(body) });
  }
}
