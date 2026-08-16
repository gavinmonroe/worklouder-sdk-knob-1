# Framer F1 recovery and backup audit

This workflow prepares a byte-for-byte recovery set before any firmware
experiment. It is device-read-only: its executable allowlist contains only
`chip-id`, `read-mac`, `get-security-info`, `flash-id`, `read-flash`, and
`espefuse summary`. It has no erase, write, burn, encryption, or force path.

The audit targets an ESP32-S3. It refuses to continue unless:

- the user supplies an explicit likely USB serial port and types
  `--confirm-device FRAMER-F1`;
- esptool identifies the chip as ESP32-S3;
- the partition table is structurally valid, within the detected flash, and has
  a factory app at `0x10000`, NVS, and a filesystem partition; and
- a small factory-app probe contains both `Framer F1` and `v.framer.bubble`
  before the complete flash is read.

The checked firmware image currently has NVS at `0x810000` (size `0x20000`) and
an `fs` partition at `0x830000` (size `0x200000`, subtype `0x82`). The audit does
not assume those addresses: it reads and parses the attached device's table.
Subtype `0x82` is historically named SPIFFS in ESP-IDF partition tables, but the
application may mount that raw partition with LittleFS, so the backup preserves
it without attempting a filesystem mount or conversion.

## Prerequisites and bootloader port

Use the current esptool 5 command names documented by Espressif. Both `esptool`
and `espefuse` must be on `PATH` (or pass their absolute paths with `--esptool`
and `--espefuse`). Do not run Input at the same time.

Put the F1 into serial bootloader mode, then list candidates without opening any:

```sh
cd f1-cli
npm run recovery:ports
```

Unplug/replug the F1 and confirm exactly which `/dev/cu.usbmodem...` entry
appears. Never guess a port and never use a broad `/dev/cu.*` glob.

The current `sendIntoBootloader()` route selects the app-resident hidden
USB/CDC flasher screen and therefore depends on normally running Framer
firmware. It is suitable for this read-only audit but cannot recover an app that
does not initialize far enough to receive the RPC. Firmware analysis found no
independent front-panel bootloader path; the factory-reset chord only erases
NVS and reboots. A live VID/PID-
filtered `esptool --before usb-reset` probe under normal Stage-1 firmware also
found zero F1 serial ports: macOS exposed the product as custom HID only.
Before a further native behavior write, locate and verify physical PCB
GPIO0/BOOT plus reset/EN access. The full evidence and official Espressif
references are in
[`docs/04-recovery-and-restore.md`](../../docs/04-recovery-and-restore.md#critical-limitation-of-the-current-entry-method).

## Preview, then capture

The dry run performs no SDK load, serial open, output creation, or hardware I/O:

```sh
npm run recovery:dry-run
```

The live command below is read-only but can take tens of minutes because it
copies the complete flash and then separately captures recovery-critical
regions. The verified default is 115200 baud: this attached unit failed during
long reads at 921600 and 460800, while a 64 KiB verification read succeeded at
115200.

```sh
node recovery/audit.mjs \
  --port /dev/cu.usbmodemNNNN \
  --confirm-device FRAMER-F1 \
  --output ./recovery-backups/f1-before-flash
```

The output directory must not exist. Treat it as sensitive: NVS can contain
pairing/configuration data. Store an encrypted second copy somewhere separate.

## Exact inspection/read commands

The script executes these command forms, without a shell:

```sh
esptool --chip esp32s3 --port "$PORT" --baud 115200 chip-id
esptool --chip esp32s3 --port "$PORT" --baud 115200 read-mac
esptool --chip esp32s3 --port "$PORT" --baud 115200 --no-stub get-security-info
espefuse --chip esp32s3 --port "$PORT" summary
espefuse --chip esp32s3 --port "$PORT" summary --format json --file efuse-summary.json
esptool --chip esp32s3 --port "$PORT" --baud 115200 flash-id
esptool --chip esp32s3 --port "$PORT" --baud 115200 read-flash 0x8000 0x1000 partition-table.bin
esptool --chip esp32s3 --port "$PORT" --baud 115200 read-flash 0x10000 0x10000 identity-probe.bin
esptool --chip esp32s3 --port "$PORT" --baud 115200 read-flash 0x0 ALL full-flash.bin
esptool --chip esp32s3 --port "$PORT" --baud 115200 read-flash "$NVS_OFFSET" "$NVS_SIZE" partition-nvs.bin
esptool --chip esp32s3 --port "$PORT" --baud 115200 read-flash "$FS_OFFSET" "$FS_SIZE" partition-fs.bin
```

`get-security-info.txt`, `efuse-summary.txt`, and `efuse-summary.json` preserve
Secure Boot, flash-encryption, secure-download, and download-disable evidence.
`manifest.json` records decoded security fields and the partition map.
`SHA256SUMS.txt` hashes every captured binary and report.

## Restore reference—do not run before review

The audit writes `RESTORE-COMMANDS-REFERENCE.txt`; it never executes those
commands. First verify hashes and re-check the exact chip:

```sh
esptool --chip esp32s3 --port "$PORT" chip-id
esptool --chip esp32s3 --port "$PORT" --no-stub get-security-info
shasum -a 256 -c SHA256SUMS.txt
```

Only when Secure Boot and Flash Encryption are confirmed disabled and the target
is the same physical F1, the full-image reference is:

```sh
esptool --chip esp32s3 --port "$PORT" --baud 115200 \
  write-flash --flash-size keep 0x0 full-flash.bin
```

An individual recovery alternative uses the offsets saved in `manifest.json`:

```sh
esptool --chip esp32s3 --port "$PORT" --baud 115200 \
  write-flash --flash-size keep 0x8000 partition-table.bin
esptool --chip esp32s3 --port "$PORT" --baud 115200 \
  write-flash --flash-size keep "$NVS_OFFSET" partition-nvs.bin
esptool --chip esp32s3 --port "$PORT" --baud 115200 \
  write-flash --flash-size keep "$FS_OFFSET" partition-fs.bin
```

Do not combine full and individual restore alternatives. If Secure Boot or Flash
Encryption is enabled, stop: flash reads may be restricted or encrypted and the
generic commands above may brick the device. Encryption keys are normally
read-protected eFuses and cannot be backed up. Never add `--force`, never erase
first, and never restore an encrypted image to another chip.

Command syntax and safety behavior were checked against Espressif's official
[esptool basic-command documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/basic-commands.html),
[ESP32-S3 eFuse summary documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/espefuse/summary-cmd.html),
and [ESP32-S3 security overview](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/security/security.html).
