# App-independent bootloader entry

Two routes into the ESP32-S3 ROM download mode that do not need the Input app, plus the
read-only esptool session they enable. Both are **live verified on a Knob 1**
(VID `0x303a`, PID `0x8296`, firmware `0.4.1`, MAC `b4:3a:45:24:21:f8`) on macOS 25.5.0
with esptool v5.3.1.

Neither route has been exercised on a Framer F1. The
[recovery-pad appendix](./11-recovery-pad-identification.md) stays open for that hardware.

## Route 1: `sys.bootloader` without an Input install

[`recovery/enter-bootloader.mjs`](../recovery/enter-bootloader.mjs) already discovers both
`DeviceType.KnobF1` and `DeviceType.Knob`, but it evaluates inside the installed
`input.app`, so it cannot run on a machine that has no Input. The same SDK call works
directly against the extracted kit:

```js
const api = new sdk.WLRPCApi(comm, quietLogger);
await api.sendIntoBootloader();   // -> { method: "sys.bootloader" }
```

[`recovery/enter-bootloader-direct.mjs`](../recovery/enter-bootloader-direct.mjs) does
exactly that. It is `--confirm`-gated and deliberately does **not** route through
`f1-cli`'s `ReadOnlyTransport`, because `sys.bootloader` is correctly absent from that
allowlist. It writes nothing to flash.

```sh
sudo node recovery/enter-bootloader-direct.mjs --confirm
```

`sudo` is required on macOS for the reason in
[docs/21](./21-knob1-macos-hid-access.md). Observed: `{"status":"ok"}`, then
`/dev/cu.usbmodem31101` about two seconds later. The suffix changes between sessions;
never copy an example port.

**Limitation, unchanged from [docs/04](./04-recovery-and-restore.md):** this needs a
working app to accept the RPC. It is entry, not recovery.

## Route 2: the two-button sequence (no app involved)

The Knob 1 exposes two tactile buttons stacked vertically beside the spacebar, reachable
by pulling that keycap. No case opening, meter, or pad probing is required.

1. Press **both** buttons.
2. Release **only the bottom** one.
3. Wait a few seconds.
4. Release the **top** one.

The device enters ROM download mode: its HID interfaces disappear and a serial port
appears.

**Bottom is EN/RESET, top is BOOT/GPIO0.** This follows from the sequence working at all.
Releasing the bottom button lets the chip leave reset while the top still holds GPIO0 low,
so the strap is sampled low at boot. Under the reverse assignment, releasing BOOT first
would leave the chip in reset and the later EN release would boot it with GPIO0 already
high — a normal boot, not download mode.

This is identification **by behaviour**, not by continuity to QFN pins 4 and 5. It is
strong evidence, but it is not the traced-to-pin proof
[docs/11](./11-recovery-pad-identification.md) asks for.

Because this route needs no application, it closes the recovery gap for the Knob 1: a
non-booting app can still be forced into the ROM downloader.

## Read-only esptool session

Pass `--before no-reset --after no-reset` on every intermediate call to stay in the
bootloader between commands. `/dev/cu.*` is `crw-rw-rw-`, so esptool needs no `sudo`.

```sh
PORT=/dev/cu.usbmodemXXXXX
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset chip-id
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset flash-id
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset get-security-info
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset \
  read-flash 0 0x1000000 full-flash-16mb.bin
```

Observed on the Knob 1:

| Property | Value |
| --- | --- |
| Chip | ESP32-S3 (QFN56) revision v0.2 |
| Features | Wi-Fi, BT 5 (LE), dual core + LP core, 240MHz, 2MB embedded PSRAM |
| Flash | 16MB, GigaDevice `c8` / `4018`, quad, 3.3V |
| USB mode | USB-Serial/JTAG |
| Secure Boot | Disabled |
| Flash Encryption | Disabled (`SPI_BOOT_CRYPT_CNT` `0x0`) |

The captured image is 16,777,216 bytes and 88.1% erased (`0xFF`). Its partition table
matches the pinned F1 expectations in `f1-widget-sdk/src/constants.mjs` exactly:

| Label | Type | Offset | Size |
| --- | --- | --- | --- |
| `phy_init` | phy | `0x00f000` | 4 KiB |
| `factory` | app | `0x010000` | 8 MiB (`0x800000`) |
| `nvs` | nvs | `0x810000` | 128 KiB |
| `fs` | spiffs | `0x830000` | 2 MiB |
| `coredump` | coredump | `0xa30000` | 64 KiB |

The app at `0x10000` carries the `0xe9` magic with **6 segments**, matching
`PINNED.segmentCount`.

## Exit

```sh
esptool --chip esp32s3 --port $PORT --before no-reset --after watchdog-reset chip-id
```

Verified round trip: normal firmware to bootloader and back, twice, by both routes. HID
re-enumerates with fresh registry IDs and `f1-cli` discovers the device again.

## Still untested

Entry is proven and a byte-exact 16 MiB image exists, but **no restore write has been
performed**. The write half of the recovery path remains unverified.
