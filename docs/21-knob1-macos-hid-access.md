# Knob 1 HID access on macOS

The Work Louder Knob 1 answers every audited read-only RPC in this repository, but on
macOS it needs `sudo`. The Framer F1 does not. This appendix records why, so the next
person does not have to rediscover it.

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
`hidutil list` confirms by binding it to `AppleUserHIDEventDriver`. The protected-HID
policy then applies to the whole device, including the vendor collection.

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

Chrome's WebHID is not a workaround. It usefully hides the protected keyboard collection
and exposes the `0xff00` one with its output report, but `sendReport` still bottoms out
in the same `IOHIDDeviceSetReport` and raises `NotAllowedError`.

## Why the Framer F1 is unaffected

`custom-firmware/README.md` records routine unprivileged HID reads from a `knob_f1` on
macOS. Same OS, same SDK, same code path, so the only variable is the descriptor: the F1
presents its vendor interface separately, giving it an `IOHIDDevice` whose primary usage
is not Keyboard, and therefore not protected. That part is inferred from the difference
in behaviour rather than measured — no F1 descriptor dump exists in this workspace.

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
