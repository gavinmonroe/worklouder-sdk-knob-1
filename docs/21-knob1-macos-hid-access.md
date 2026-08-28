# Knob 1 HID access on macOS

The Work Louder Knob 1 answers every audited read-only RPC in this repository, but on
macOS `f1-cli` needs `sudo` to reach it. The Framer F1 does not. This appendix records
what was measured, so the next person does not have to rediscover it.

The measurements are solid. The *mechanism* is still open: the first explanation written
here was falsified by the F1's own descriptor, and
[Why the Framer F1 is unaffected](#why-the-framer-f1-is-unaffected) records both the
correction and the test that would settle it.

**Live verified** on macOS 25.5.0, Node v22.23.2, against Knob 1 firmware `0.4.1`
(VID `0x303a`, PID `0x8296`, ANSI).

## Symptom

Discovery and connection succeed; every RPC that writes a report fails.

```
"version": { "ok": false, "error": "firmware version: Cannot write to hid device" },
"status":  { "ok": false, "error": "device status: Cannot write to hid device" }
```

Granting Input Monitoring does not fix it. That permission governs *reading* input
reports from a keyboard; it does not grant permission to *send* output reports.

## Cause

The Knob 1 exposes five HID collections on a **single** USB interface, sharing one
device path:

| usagePage | usage | meaning |
| --- | --- | --- |
| `0x0001` | `0x06` | Keyboard |
| `0x000c` | `0x01` | Consumer Control |
| `0x0001` | `0x02` | Mouse |
| `0x0001` | `0x01` | Pointer |
| `0xff00` | `0x01` | Vendor RPC (output report `6`, 63 bytes) |

macOS therefore creates one `IOHIDDevice` whose *primary* usage is Keyboard, which
`hidutil list` confirms by binding it to `AppleUserHIDEventDriver`.

That shape alone is **not** what causes the refusal — see
[Why the Framer F1 is unaffected](#why-the-framer-f1-is-unaffected), which measures the
identical shape on a device that writes fine. What follows is measured; the explanation
comes after it.

Calling IOKit directly separates the permission from the transport:

| Call | uid 501 | uid 0 |
| --- | --- | --- |
| `IOHIDDeviceOpen(0)` | `kIOReturnSuccess` | `kIOReturnSuccess` |
| `IOHIDDeviceSetReport(Output, id 6)` | `kIOReturnNotPermitted` (`0xe00002e2`) | `kIOReturnSuccess` |
| `IOHIDDeviceSetReport(Feature, id 6)` | `kIOReturnNotPermitted` | `kIOReturnSuccess` |
| `IOHIDDeviceOpen(SeizeDevice)` | `kIOReturnNotPrivileged` (`0xe00002c1`) | `kIOReturnSuccess` |

Reproduce with [`f1-cli/tools/macos-hid-probe.py`](../f1-cli/tools/macos-hid-probe.py),
which sends only `sys.version`:

```sh
python3 f1-cli/tools/macos-hid-probe.py        # NotPermitted
sudo python3 f1-cli/tools/macos-hid-probe.py   # succeeds
```

The framing is not the problem. The report descriptor declares Report ID `6` with an
Output count of `0x3F` (63 bytes), which is exactly what `wl-device-kit` sends as
`Buffer.alloc(64)` with `data[0] = 6`. Lengths 63, 64 and 65 all fail identically at
uid 501 and all succeed at uid 0.

Chrome's WebHID is not a workaround **on this device**. It usefully hides the protected
keyboard collection and exposes the `0xff00` one with its output report, but `sendReport`
still bottoms out in the same `IOHIDDeviceSetReport` and raises `NotAllowedError`. This is
measured on the Knob 1 only; it is not a statement about WebHID in general, which writes
to a Framer F1 on the same OS every day (below).

## Why the Framer F1 is unaffected

An earlier revision of this document claimed the F1 "presents its vendor interface
separately, giving it an `IOHIDDevice` whose primary usage is not Keyboard, and therefore
not protected", and flagged that as inferred because no F1 descriptor dump existed here.
**The dump was one command away and says the opposite.** On a Framer F1
(`0x303a:0x8396`, serial `A4CB8FAF3210`) attached to macOS 26.x, `ioreg -w0 -rn "Framer F1" -l`
reports a single HID interface:

- `bInterfaceClass = 3`, `bInterfaceNumber = 0` — the only HID interface
- `PrimaryUsagePage = 1`, `PrimaryUsage = 6` — Keyboard
- bound to `AppleUserHIDEventDriver`, exactly as the Knob 1 is
- `DeviceUsagePairs = ({1,6}, {12,1}, {1,2}, {1,1}, {65280,1})` — Keyboard, Consumer
  Control, Mouse, Pointer and vendor `0xff00`, all on that one interface

That is the table at the top of this document, on the F1. Its report descriptor declares
Keyboard as Report ID `1`, Consumer Control `2`, Mouse `3`, and the vendor collection
Report ID `6` with an Output count of `0x3F` — again identical.

And Chrome writes report `6` to it, unprivileged, over WebHID: that is how
`web-flasher/src/lib/framer-hid.js` talks to an F1, and how the Widget Designer pushes
widgets to one.

So "all five collections on one interface, primary usage Keyboard" is **not sufficient**
to cause the refusal. The two devices differ somewhere else, and the leading candidate is
which **report ids** a protected collection claims: macOS refuses `SetReport` for an id a
keyboard collection also owns, and Chrome hides protected collections' report ids, so no
descriptor dump can show it. `probeWritableReportIds()` in `framer-hid.js` asks Chrome for
its verdict on ids `1`–`8` and prints `NotAllowedError` (Chrome knows the id and refuses
it) versus `NotFoundError` (the id is not declared) — which distinguishes the two cases
directly. That measurement has not been taken on a Knob 1 yet.

What this changes practically: **do not tell Knob 1 owners the browser can never work, and
do not present sudo as the general fix.** The uid-501-vs-uid-0 table above is a real
measurement of `f1-cli` on that hardware and stands on its own. The mechanism behind it
does not, and if the report-id hypothesis holds, the fix is a firmware change moving the
vendor RPC off a protected id — not a permission, and not root.

## Working commands

```sh
sudo node f1-cli/bin/f1-readonly.mjs inspect --apps
sudo node f1-cli/bin/f1-readonly.mjs backup --output ./backups/knob1-first
```

`--all-devices` is no longer required: `F1_DEVICE_TYPES` now accepts `knob` as well as
`knob_f1`. The transient display bubble stays Framer-F1-only via `BUBBLE_DEVICE_TYPES`,
because it is a display RPC that has never been exercised on a Knob 1.

Running Node as root is acceptable here only because `ReadOnlyTransport` enforces a
hardcoded method allowlist and refuses everything else before it reaches HID. Do not
generalise it to the flasher.

## Observed Knob 1 state

For reference, a healthy unit reports firmware `0.4.1`, two encoders, three Bluetooth
channels, `activeApps: []` and `installedApps: []`, and a filesystem of `keymap.json`,
`smart_actions.json`, and a `wallpapers` directory. Directories come back from `fs.list`
with no `checksum`, which is how `backup` now tells them apart from files.

Sharing a firmware version string with the F1 is **not** clearance to flash F1 images to
a Knob 1. Every image under `custom-firmware/` is byte-pinned to the F1 application
binary and was live-validated only on that hardware.
