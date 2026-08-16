# Recovery and restore runbook

This is the recovery gate for firmware experiments. Commands containing
`write-flash` are reference procedures and must not be run until the backup is
complete and the target files have been reviewed. The backup portion is now
complete; independent ROM entry after a nonbooting app remains pending.

## Recovery principles

- Identify one exact physical F1 and one exact serial port.
- Capture the entire 16 MiB flash, not only the public 0.4.1 prefix.
- Preserve NVS and filesystem bytes even when their format is unknown.
- Save security/eFuse evidence because restoration assumptions depend on it.
- Hash every capture and keep a second encrypted copy.
- Prove an app-independent route into the ESP32-S3 ROM bootloader.
- Prefer an app-only write/restore at `0x10000` for app experiments.
- Never erase the full flash first and never add `--force`.

## Tooling

The workspace uses project-local esptool 5.2.0:

```sh
python3 -m venv .venv-esptool
.venv-esptool/bin/pip install esptool
.venv-esptool/bin/esptool version
```

The environment is ignored by Git. `radare2` is useful for offline analysis but
is not needed to back up or restore.

## Enter the serial bootloader

1. Quit both Input and Input Lab so they do not contend for the USB device or
   Input's single-instance lock.
2. Launch the signed installed Input app with a localhost-only main-process
   debugger:

   ```sh
   open -n -a input --args --inspect=9230
   ```

3. With exactly one USB-connected F1, ask the SDK to enter its bootloader:

   ```sh
   node recovery/enter-bootloader.mjs
   ```

4. Identify the newly appearing port. Do not copy the example port blindly:

   ```sh
   node f1-cli/recovery/detect-ports.mjs
   ```

The observed port in this session is `/dev/cu.usbmodem83201`; macOS may assign a
different suffix after reconnecting.

### Critical limitation of the current entry method

**Live verified for entry; not sufficient as app-independent recovery.**
`recovery/enter-bootloader.mjs` calls `sendIntoBootloader()` through the running
compatible application. It works for inspection and backup, but a nonbooting
custom app cannot receive that RPC. Possessing perfect restore bytes is not
enough if there is no independent way to reach the ROM downloader.

**Offline verified.** The firmware's hidden Bootloader screen is ID `21`, an
application-resident USB/CDC flasher path rather than an independent hardware
reset into ROM. `sys.bootloader` handler `0x42005A50` selects it through
`0x4210AF1C`, but the Fn+dial screen registry excludes ID 21. The only
literal-21 selector found is the RPC path. There is therefore no known
front-panel chord or normal widget navigation route into the flasher.

A future firmware patch could add an early safe-mode chord that selects screen
21 after the application and input dispatcher initialize. That would be useful
for a broken widget/view while the base app still reaches its event loop. It
would not recover an image that crashes before application initialization, so
it complements rather than replaces physical GPIO0/BOOT plus reset/EN.

**Live verified USB-reset failure.** Under the normally booted Stage-1 app,
macOS IOUSB sees `Framer F1` as custom HID with VID `12346`/`0x303A`, PID
`33686`/`0x8396`, and serial `A4CB8FAF3210`. PySerial found only the Mac's
Bluetooth/debug-console devices and zero F1 TTYs. The exact filtered probe was:

```sh
esptool \
  --port-filter vid=12346 --port-filter pid=33686 \
  --before usb-reset --after no-reset \
  chip-id
```

It found zero serial ports and did not connect. Thus `usb-reset` is not an
app-independent recovery route under normal Framer firmware even though the
ESP32-S3 USB download eFuses are not disabled.

The factory-reset chord is separate and must not be confused with recovery. It
operates from home/status screen ID `0`: both Fn keys/type `5`, count at least
`2`, more than 6000 ms after screen entry. Handler `0x4210888C` reaches
`0x4201FDDC`, erases NVS through `0x4202D304`, and reboots through `0x42030B04`.
The 6000 ms condition is the age of the home screen, not a six-second key hold:
once home has been active that long, pressing both Fn keys concurrently likely
triggers it immediately. It is destructive to settings and **does not enter the
ROM bootloader**. Exhaustive cross-references found only its NVS-erase path and
only delayed-update use for the hidden Bootloader screen; no alternate physical
bootloader call was found.

The static and live evidence therefore leaves physical PCB access to GPIO0/BOOT
plus reset/EN as the only app-independent recovery route. Espressif's official
[ESP32-S3 boot-mode guide](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html)
documents holding GPIO0 low on reset to enter ROM serial-download mode. The
[USB Serial/JTAG guide](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/usb-serial-jtag-console.html)
likewise recommends manual GPIO0/reset when application USB behavior prevents
automatic download.

Stage 1 was successfully flashed while the chip was already in ROM and then
booted normally. That result does not establish recovery from a future
nonbooting image. Locate and verify the PCB strap/reset path before Stage 2.
The unreferenced Stage-3A IROM-growth canary has also been written, read back
exactly, and booted normally after structural/loader GO. It proves controlled
image growth, not recovery from a nonbooting callable image. Stage 3C later
wrote/read back exactly and booted normally too, still without proving
app-independent recovery. The physical gate therefore remains important for
Stage 2 and future crash-prone images.
The chip pins, strap timing, board-unknown boundary, and conservative no-write
proof are detailed in the
[physical recovery-pad appendix](./11-recovery-pad-identification.md).

## Reconfirm identity and security

Set a task-specific variable to the exact discovered port:

```sh
FRAMER_PORT=/dev/cu.usbmodem83201
.venv-esptool/bin/esptool --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 chip-id
.venv-esptool/bin/esptool --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 flash-id
.venv-esptool/bin/esptool --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 --no-stub get-security-info
.venv-esptool/bin/espefuse --chip esp32s3 --port "$FRAMER_PORT" summary
```

Stop if the chip is not ESP32-S3, flash is not 16 MiB, Secure Boot or Flash
Encryption is enabled, UART download is disabled, or the identity differs from
the pre-experiment record.

## Guarded audit workflow

The read-only audit refuses mutating esptool/eFuse commands and requires the
literal confirmation `FRAMER-F1`. Its default is the attached unit's verified
115200 baud rate; passing it explicitly keeps the experiment record obvious.

Preview without touching hardware:

```sh
node f1-cli/recovery/audit.mjs \
  --port /dev/cu.usbmodem-FRAMER-F1 \
  --confirm-device FRAMER-F1 \
  --baud 115200 \
  --dry-run
```

Then use the real exact port and a fresh output directory:

```sh
node f1-cli/recovery/audit.mjs \
  --port "$FRAMER_PORT" \
  --confirm-device FRAMER-F1 \
  --baud 115200 \
  --esptool .venv-esptool/bin/esptool \
  --espefuse .venv-esptool/bin/espefuse \
  --output recovery/backups/f1-before-custom
```

The audit reads the partition table and a Framer identity probe before the full
flash. It expects `Framer F1` and `v.framer.bubble` in the factory app and saves
full flash, NVS, filesystem, reports, a manifest, hashes, and restore-command
references. The destination must not already exist.

## Exact manual full-flash capture

The live backup in this research session used this no-progress command because
higher baud rates failed:

```sh
.venv-esptool/bin/esptool \
  --chip esp32s3 \
  --port "$FRAMER_PORT" \
  --baud 115200 \
  --after no-reset \
  read-flash --no-progress \
  0x0 0x1000000 \
  recovery/backups/f1-before-custom/full-flash-16mb.bin
```

At 115200, a 16 MiB read can take roughly tens of minutes. Do not open the same
serial port from another process while it runs.

## Validate and split a full capture

The exact size must be 16,777,216 bytes:

```sh
FRAMER_BACKUP=recovery/backups/f1-before-custom
wc -c "$FRAMER_BACKUP/full-flash-16mb.bin"
shasum -a 256 "$FRAMER_BACKUP/full-flash-16mb.bin"
head -c 2025536 "$FRAMER_BACKUP/full-flash-16mb.bin" | shasum -a 256
```

If the device was still running stock 0.4.1, the prefix hash should be:

```text
c8926bd181bc06062d8c79221c6bb1c7f85463f0034444f263e1995cb383b976
```

### Recorded result for this F1

The completed backup directory is:

```text
recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/
```

The full image is 16,777,216 bytes with SHA-256
`aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd`.
Its 2,025,536-byte installed prefix exactly matches official 0.4.1. The stored
`SHA256SUMS.txt` verifies 17/17 files. The manifest records the complete
partition hashes and the verified baud rate.

For the currently known layout, split recovery-critical regions in 4 KiB
blocks. These extractions are offline; they do not touch the device:

```sh
dd if="$FRAMER_BACKUP/full-flash-16mb.bin" of="$FRAMER_BACKUP/partition-table.bin" bs=4096 skip=8 count=1
dd if="$FRAMER_BACKUP/full-flash-16mb.bin" of="$FRAMER_BACKUP/partition-nvs.bin" bs=4096 skip=2064 count=32
dd if="$FRAMER_BACKUP/full-flash-16mb.bin" of="$FRAMER_BACKUP/partition-fs.bin" bs=4096 skip=2096 count=512
shasum -a 256 "$FRAMER_BACKUP"/*.bin
```

Re-read and parse the saved partition table before treating these hardcoded
offsets as authoritative. The guarded audit does that automatically.

## App-only restoration

If a custom app fails and the independent ROM-entry route has restored
bootloader access, restore only the official extracted 0.4.1 app. This
preserves the live NVS and filesystem:

```sh
shasum -a 256 artifacts/firmware/framer_app_0.4.1.bin
# expected: ee3127e3ffabb462f719ff493642592110cc7020df569e44acc50b6a5a736000

.venv-esptool/bin/esptool \
  --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 \
  write-flash --flash-size keep \
  0x10000 artifacts/firmware/framer_app_0.4.1.bin
```

Read the same byte count back and compare hashes before resetting:

```sh
.venv-esptool/bin/esptool \
  --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 \
  --after no-reset read-flash --no-progress \
  0x10000 0x1de840 /tmp/framer-app-readback.bin
shasum -a 256 /tmp/framer-app-readback.bin
```

The expected size `0x1DE840` is 1,960,000 bytes. Reset only after the read-back
hash matches the image just written.

## Full restoration

Use the complete same-device backup if app-only restoration is insufficient or
other partitions were modified. Reconfirm security state and backup hashes
first:

```sh
.venv-esptool/bin/esptool --chip esp32s3 --port "$FRAMER_PORT" --no-stub get-security-info
shasum -a 256 "$FRAMER_BACKUP/full-flash-16mb.bin"

.venv-esptool/bin/esptool \
  --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 \
  write-flash --flash-size keep \
  0x0 "$FRAMER_BACKUP/full-flash-16mb.bin"
```

Do not combine full restore with separate partition writes. Do not move an
encrypted dump between devices. For this attached unit encryption is live-
verified disabled, but that assumption must be rechecked each session.

## Exit bootloader

After both the Stage-1 and Stage-3A write/read-back experiments, esptool's
watchdog-reset teardown returned the unit to its app. A plain USB-RTS `run` had
left the unit in ROM during Stage 1. A harmless identity read with the verified
exit mode is:

```sh
.venv-esptool/bin/esptool \
  --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 \
  --after watchdog-reset chip-id
```

The device then re-enumerated normally as `knob_f1`. USB serial port names may
change or disappear across this reset. Reopen Input only after esptool releases
the bootloader port.

For a guarded read-only post-boot check, relaunch Input with its local debugger
and use the repository verifier:

```sh
open -n -a input --args --inspect=9230
node recovery/verify-live-firmware.mjs
```

[`recovery/verify-live-firmware.mjs`](../recovery/verify-live-firmware.mjs)
requires exactly one USB-connected F1 and reads only firmware version, device
status, and current screen through the SDK bundled with Input. It does not
change firmware or settings. Reopen Input normally when the check is complete.
