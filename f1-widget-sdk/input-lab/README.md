# Input Lab editor

Input Lab is a host-side editor for the exact `100x310` Framer F1 logical canvas. Renderer v1 has two
reusable compiler lanes:

- **Semantic CSS** uses the shared scene compiler and a cached, SHA-pinned Hiragino/ImageMagick glyph
  atlas. The canvas advances on the same 100 ms device ticks and draws those compiled atlas masks.
- **Chromium raster** paints sandboxed inline HTML/CSS/SVG in one version-pinned headless Chrome CDP
  session, seeks CSS animations to exact frame times, quantizes to RGB565, fits the result to the hard
  128 KiB F1RA limit, decodes it again, and previews the decoded device frames—not the browser originals.

The **Render v2 events** mode accepts HTML/CSS plus the documented bounded `widget.on(...)`
JavaScript/DOM-shaped subset. It statically compiles one F1WB+F2EP package and previews exact RGB565
output from the SDK runtime. The simulator replays at most 64 ticks, Fn+bottom-dial events, and
fixed-ID host RPC events while showing integer state and compile budgets. It does not run arbitrary
JavaScript, `jsdom`, or user source on the device.

Render v2 has **Auto**, **Semantic**, and **Chromium raster** render lanes. Auto keeps compatible
renderer-v1 semantic scenes semantic, then falls back to the same sanitized, version-pinned Chromium
service for richer nested HTML/CSS and gradients. The raster lane parses the bounded widget source but
never executes it. It fresh-renders the exact RGB565 base plus every declared text, color, and
`formatTime` variant through host-controlled DOM mutations, then emits absolute F2EP patches only after
the initial state, layout stability, disjoint dirty regions, every individual variant, one deterministic
alternate for every binding pair, and one deterministic all-bindings state pass fresh-render parity.
When the complete Cartesian state product fits the 96-render ceiling, every state is fresh-rendered and
verified. Larger state spaces are admitted only when every dynamic target proves a positive fixed box
inside the viewport with `contain:size layout paint` (or `contain:strict`), distinct target boxes do not
overlap, their containment clips are not extended, every emitted patch pixel remains inside its target
box, and no filtered/blended ancestor couples their paint. Multi-binding `formatTime` targets also require
tabular numbers, disabled kerning/ligatures/text shadows, and normal horizontal LTR text. The compiler
still fresh-renders every individual variant plus deterministic pair/all-binding controls; the manifest
states which verification model was used instead of presenting samples as an exhaustive proof.

Both models first enforce `framer-render-v2-raster-mutation-isolation-v1`: authored mutations are limited to
`textContent` and `style.color`, while mutation-sensitive CSS fails closed. Attribute/bracket selector
syntax, `:has()`, `:empty`, `:blank`, `:dir()`, `attr()`, container/style queries, `mix-blend-mode`,
cross-element value functions, `backdrop-filter`, and escaped CSS identifiers are rejected because they can make one target react only
to a particular multi-state combination. Reflow, CSS animation/transition state, overlapping bindings,
external content, nondeterministic paint, and F2EP span/pixel budget overflow also fail closed. Rich
static gradients, nested layout, transforms, shadows, and ordinary local filters remain supported.

Its focused keyboard test pad maps one configured `KeyboardEvent.code` to host-RPC value `1` on keydown
and `0` on keyup. Repeat, composition, and editable targets are ignored; release is synthesized on lost
focus, hidden/page-exit, or device disconnect. This is a browser key-to-host-RPC bridge, not a native
F2EP `input.key` event.

The separate MicroQuickJS canary contract has a reusable Input Lab simulator in
`lib/mquickjs-key-events.mjs`. It models the device-side limits exactly: 16 stable numeric key IDs,
8 order-independent exact-mask chords of 2–4 keys, a 32-record ingress queue, four raw records and two
coalesced holds per logical batch, a 64-event staged FIFO, 1–50 ms debounce, 100–5,000 ms hold delay,
and 20–1,000 ms hold cadence. Each simulator owner iteration releases at most three staged events; a
caller must yield and call again after `morePending` rather than draining in a tight loop.
It emits `input.key.down`, `input.key.up`, `input.key.hold`, `input.chord.down`, and
`input.chord.up` event objects with one monotonic sequence and an immutable `heldMask` snapshot;
`mquickJsEventIsHeld(event, keyId)` mirrors `widget.isHeld(...)`. `BrowserMQuickJsKeyBridge` uses
`KeyboardEvent.code` only for browser simulation and synthesizes deterministic release edges on blur,
hidden/page-exit, and disconnect.

`InputLabMQuickJsNativeKeyRecorder` is the constrained learn/record seam. It stores the exact observed opaque
u32 native token plus level and sequence, then lets the user attach a label or browser code; it never
guesses a physical key map. Device recording remains disabled unless a keyboard advertises the exact
stock-first hook, fixed owner-task queue, and observation capabilities.

The browser now probes the physical canary through all 13 bounded
`widget.mquickjs.cap` pages. It accepts only the exact compact grammar, reports
screen ID28 as `physicalCanary: true`, and preserves the honest device claims
`hardwareRuntimeProven: false` and `runtimeUploader: false`. The accepted
`baseApp` hash is ancestry—not a fabricated running-app self-hash—and the full
module/package hashes can be compared with a pinned release manifest. Missing,
duplicated, reordered, rich, over-112-byte, or mismatched pages fail closed.

Declared weather host events use `widget.mquickjs.event` with exact
`{id,value,auxiliary,generation,revision}` fields. Input Lab allows only one
outstanding event, requires the initial `Q`, then polls
`widget.mquickjs.receipt` until the same sequence and fields reach `A`.
Undeclared IDs and reserved B24D OOM/timeout sentinels are blocked in the normal
UI. Physical detection and host-event testing do not enable Package Push: the
button stays disabled while `runtimeUploader=false`, even if an uploader-shaped
host object is supplied. The external guarded one-hour receipt—not the device
capability—promotes physical-runtime evidence.

For the Weather example, **Refresh fixture** derives a deterministic offline snapshot
from the entered ZIP code. The redesigned weather widget has no fixed place label, so
physical delivery accepts any 5-digit US ZIP, not only the original `60601` fixture
(the `F2TF` build in `experiments/mquickjs-target-facade` that hard-baked a `CHICAGO`
location literal predates that redesign). Input Lab reads one coherent ordered
telemetry p0..p5 session, then sends exactly begin/current/three-day/commit inside
one exclusive client transaction, so another button or key action cannot interleave
between staged records or the pixel check.
All six payloads share one weather revision, each device-assigned receipt
sequence must be unique, pre-commit receipts must not expose that revision, and
the final commit must report it as applied. A second bounded telemetry probe
distinguishes mailbox commit from pixels: while ID28 is visible, both the VM/mailbox
and UI weather revisions must match before Input Lab says rendered; while hidden,
Input Lab says the runtime committed it and rendering is deferred until the next
ID28 entry. A transient device snapshot-lock collision retries the entire ordered
p0..p5 session up to three times; Input Lab never resumes at a middle page, and
malformed grammar or changed identity still fails immediately. This is explicitly
an offline fixture; it does not claim a live provider or network fetch.

The ZIP field reads and writes the same `f1-widget-sdk/build/zip-sync-config.json`
file that `examples/render-v2-mquickjs-weather-canary/tools/zip-sync.mjs` (the
keyboard-editable-ZIP host tool, which does use a real forecast provider) persists
to, via `GET`/`POST /api/zip-sync/config` on the local dev bridge — a ZIP saved from
the physical knob shows up here, and typing a ZIP here is what that tool pushes to
the device on its next boot. This sync is loopback-only and best-effort; hosted
Input Lab has no local device filesystem, so its ZIP field is not persisted this way.

The three distinct seeded previews are `Working`, `Generating`, and `Electric`. Their source,
settings, and compact compiled payload are stored locally. Render v1 `Apply / Push` compiles all three
v1 slots into one F1WB bundle. Render v2 treats the slots as authoring presets and applies only the
active widget to screen ID26 after a compatible device capability probe.

## One Vite web app

```sh
cd f1-widget-sdk
npm run input-lab
open http://127.0.0.1:5173
```

Vite is the only browser packaging path. `npm run input-lab:build` writes relative static assets to
`input-lab/build/web`; `npm run input-lab:preview` serves that exact build on port 4173. The output can
also be deployed under an arbitrary static-host path because its Vite base is `./`.

Production static hosting must send the same security headers used by Vite preview: a CSP with only
same-origin scripts/styles, `connect-src` limited to self plus the loopback bridge, no workers/objects or
third-party scripts, and `Permissions-Policy: hid=(self), serial=(self), usb=()`. Do not add a service
worker: a stale cached firmware binary is unacceptable. HTTPS-hosted pages reaching the HTTP loopback
bridge also require Chrome Private Network Access; the bridge answers that preflight only for an exact
allowlisted origin.

Static mode remains useful without any native process: it edits arbitrary bounded HTML/CSS/SVG, runs a
scriptless/networkless 100x310 iframe preview, stores exactly three named slots in localStorage, and
exports all source/settings as `framer-f1-input-lab-project-v2`. The Push button stays disabled and says
why when neither an explicit WebHID connection nor an enabled localhost bridge is available.
Source, settings, and slot-name edits are autosaved after a short delay and flushed before slot changes,
project export, device Push, tab suspension, and page shutdown, so restarting the editor restores all
three customized slots instead of the seeded previews.

The exact semantic compiler, pinned font atlas, deterministic Chromium capture, and optional Input RPC
remain in a separate loopback bridge:

```sh
npm run input-lab:bridge
```

The web app probes `http://127.0.0.1:9231/api/bridge`; it never starts the bridge or opens hardware.
The default bridge is compile/capture-only with `MockSceneTransport`, so device Push remains gated. A
hosted origin must be explicitly allowlisted, for example:

```sh
npm run input-lab:bridge -- --allow-origin https://lab.example
```

Only exact allowlisted origins receive the per-process 256-bit session token. The bridge binds to
127.0.0.1, restricts the Host header, uses explicit CORS instead of a wildcard, and caps compile/apply
bodies. A page can override the loopback port with `?bridge=http://127.0.0.1:PORT`; non-loopback bridge
URLs fail closed.

`InputWlrpcSceneTransport` is the bounded bridge. It allowlists the six `widget.scene.*` methods, embeds
parameters as inert JSON/base64, requires exactly one USB Framer F1 on firmware 0.4.1, and performs one
bounded Input evaluation per RPC. Merely constructing it does not discover or open hardware.

An explicit **unproven local-bridge canary** is available for a freshly booted development image whose embedded
scene and RPC state both start at generation 1:

```sh
open -n -a input --args --inspect=9230
npm run input-lab:bridge -- --confirm-live-rpc
```

This flag replaces the mock only for that localhost server process. The canary accepts the exact
firmware reply shape `{status:"ok"}`, starts its session at expected generation 1 / upload generation 2,
and increments after each acknowledged commit. It retries one explicit `{status:"error"}` begin after
150 ms so the UI tick can finish the prior freeze/handoff. It does not retry a timeout or malformed
reply. If a commit reply is indeterminate, the session blocks later pushes; reboot the device and restart
the server rather than guessing its generation.

The editor labels this result `UNPROVEN hardware canary · commit acknowledged; UI handoff unverified`.
It does not claim that pixels changed, does not call the rich publisher, and does not add anything to
`LIVE_PROVEN_FRAMER_SCENE_HANDLERS`. Promotion still requires an exact app hash/device receipt, all six
methods, steady-state heap evidence, repeated UI-thread handoffs, and a device soak. Without
`--confirm-live-rpc`, Apply/Push remains mock-only.

Raster capture rejects scripts, event handlers, `<base>`, embedded documents, network/file resources,
and external URLs. Inline SVG/CSS filters such as `url(#noise)` and cached `data:` assets are allowed.
The optional Hover setting is a fixed captured state: `:hover` selectors are rewritten to the bounded
capture class; it does not synthesize pointer movement during the loop. Capture reports the exact Chrome
product, source-frame count, selected-frame count, changed-pixel ratio, raw/encoded sizes, headroom,
and whether frames were auto-reduced. The default 10-source-frame capture completes in one Chrome
process; the current pinned product is `Chrome/151.0.7922.138`.

## Browser device paths

`Connect keyboard` is always a user-gesture WebHID chooser. It reuses the Web Flasher's proven Framer
report framing: report `0x06`, RPC channel 2, and 61-byte payload chunks. Runtime scene Push uses the
six `widget.scene.*` methods directly through WebHID and a browser-only Web Crypto/Uint8Array publisher;
it does not bundle Node `crypto` or `Buffer` polyfills. The current renderer replies are status-only, so
the UI labels a successful commit as a canary acknowledgment rather than proof of UI handoff. The local
bridge still supplies the native F1WB compilation before this direct browser transport sends it.

Render v2 uses a separate fail-closed probe. A compatible generic renderer must return the exact
`framer-f1-render-v2-structural-v1` profile, `framer-render-v2-package-v1` format, scene-store and chunk
limits, and committed generation. When present, **Apply V2 to ID26** compiles and sends only the active
preset, and repeated pushes use the reported generation. Browser key levels can then forward through
the same serialized WebHID client. The exact clock/timer firmware does not advertise generic admission,
so compilation and simulation remain available while device Push is shown as unavailable.

`Flash renderer app` is a separate, explicit destructive workflow. It validates the exact smoke-approved
renderer image and SHA, asks normal firmware to enter the ROM bootloader over WebHID, then uses WebSerial
and esptool-js to verify ESP32-S3 identity, MAC, 16 MB flash, and security state. It writes only the app
partition at `0x10000`, never erase-all/NVS/filesystem, relies on device write-hash verification, and waits
for firmware 0.4.1 to return healthy. WebHID runtime RPC and WebSerial ROM flashing are deliberately not
presented as the same transport.

## Legacy research launcher

The earlier copied Input Lab.app tooling remains for research and never modifies `/Applications/input.app`,
but it is not a second web build. New distribution and hosted work must consume `input-lab/build/web`.
Preparing the historical app seam remains explicit:

```sh
cd f1-widget-sdk
npm run input-lab:prepare-app -- --force
```

No tool in this workflow writes to the signed production app.

Reusable host APIs are exported as `framer-f1-research-widget-sdk/input-lab`.

## Test

```sh
npm run input-lab:test
npm run input-lab:build
npm test
```
