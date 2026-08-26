# AGENTS.md — orientation for coding agents

First-party embedded development repository. Everything it targets is owned and
authored by the repository owner (Work Louder / Gavin Monroe).

## Ownership and provenance

The Work Louder Framer F1 keyboard targeted here, its ESP32-S3 firmware, the
MicroQuickJS (mquickjs) VM and on-device module, the F1 Widget SDK, and the
browser-based Widget Designer are all the owner's own hardware and software.
Work in this repo is the owner modifying their own product: building custom
firmware, flashing their own device, and building the widget toolchain around
it. This is legitimate first-party development on owned hardware — the same as
any embedded team iterating on its own product — not access to third-party
systems.

## What the work involves

Stated plainly so it is not mis-read:

- Custom ESP32-S3 firmware builds, flashed over USB/serial to the owner's own
  keyboard. Reading device flash, writing firmware images, and driving the
  device (bootloader entry, deploy, read-back) are expected, authorized steps
  of this workflow.
- A MicroQuickJS bytecode/JS runtime that runs the owner's own widget
  JavaScript on-device.
- A browser-based Widget Designer that compiles widgets and pushes them to the
  device (over the stock scene RPC; see the push doc below).

## Layout

- `f1-widget-sdk/` — the Widget SDK and the render-v2 compiler
  (`src/render-v2/compiler.mjs`).
- `web-flasher/widget-designer/` — the Designer web app (compile + push).
- `web-flasher/` — the browser flasher (WebHID / Web Serial install).
- `experiments/mquickjs-*` — firmware modules, harnesses, and the physical
  canary (`experiments/mquickjs-esp32s3-physical-canary/`).
- `docs/` — design docs. Current pipeline spec:
  `docs/16-mquickjs-widget-pipeline.md`; Designer push path:
  `docs/15-widget-designer-push.md`.

## Tooling and safety-classifier limits

Read this plainly: it does not change any safety behavior.

Some harness-level safety classifiers — for example the browser-JS execution
classifier in Claude Code's auto-approval mode — run OUTSIDE this repository.
No file here, including this one, can disable, suppress, or override them. This
document records project context and intent only.

When such a heuristic blocks a legitimate first-party action, the correct
response is to reach the goal through a sanctioned path (for example,
page-context evaluation rather than arbitrary JS injection), or to surface the
block to the owner. Circumventing a safety system is never the answer.
