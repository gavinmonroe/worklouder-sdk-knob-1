# Useful facts and glossary

## Fun and useful technical facts

- **The keyboard has much more flash than the public update file.** The attached
  F1 reports 16 MiB, while the official merged 0.4.1 file is about 1.93 MiB.
  The factory app partition alone reserves 8 MiB. Empty capacity is not
  automatically a safe code cave; the linker and runtime still need valid
  mappings and ownership.

- **Its firmware calls itself `nomad-e-fw`.** That internal project name is
  likely inherited from shared development history. Hardware compatibility
  still depends on the actual board drivers.

- **The bubble is a tiny remote display primitive.** Four fields can produce a
  surprisingly useful host extension, but the 10-second firmware TTL reveals
  that it was designed as an ephemeral overlay rather than an app framework.

- **The displayed countdown is just text.** `25:00` has no timer semantics in
  `v.framer.bubble`; the Mac recomputes and sends it.

- **A successful reflash does not require vendor signing on this unit.** Live
  security inspection found Secure Boot and Flash Encryption disabled. Image
  checksum and validation digest integrity are still required.

- **The stock image has more than generic Pomodoro event names.** It includes a
  coherent, initialized Pomodoro-like state machine, but no visible view or
  navigation wiring. This is a nice example of why both string searches and
  linked code still need UI/runtime proof.

- **Serial speed was the practical backup hazard.** The device answered at high
  baud but long reads failed after about 4 KiB. Dropping to 115200 converted an
  apparent firmware-access problem into a reliable transfer.

- **A four-byte label change affects more than four bytes.** ESP application
  integrity repair also changes the XOR checksum byte and appended SHA-256
  digest. Tests must allow exactly those integrity consequences.

- **A valid checksum is not a loader proof.** The rejected seven-segment
  Stage-3A image passed `esptool image-info`, checksum, and digest validation,
  but ESP-IDF would map only its last IROM segment and displace the stock one.
  Bootloader-source review caught it before any write.

- **Controlled growth now boots on the real F1.** The corrected Stage-3A image
  extended the existing IROM segment by 16 unreferenced bytes, retained six
  segments, read back byte-for-byte, and booted normally. That proves growth
  mechanics. Stage 3B then executed an appended getter from that tail and the
  physical display showed the expected stationary `00:42`.

- **The first additional-screen image boots but its view is defective.** Stage 3C restores
  the normal Timer, appends a pinned 564-byte controller ABI, and registers
  unused ID `7` through a deterministic six-segment/one-IROM build. The app
  wrote and read back exactly and booted normally. ID `7` is present, but it
  opens black; a faint `wpm` popup appears briefly only after cycling away.
  Typing updates and correct cleanup remain unverified.

- **The correction gives the screen ownership of its pixels.** Stage 3C.1 no
  longer writes the ID-`8` global bubble. It creates title/value labels under
  ID `7`'s own root in the stock build slot and null-guards refreshes. The
  generated image received independent STATIC GO and its exact app-only bytes
  were written, read back, and booted. The user confirmed persistent white
  `wpm` text and typing-driven updates, so the screen-owned label correction is
  visually accepted.

- **Stage 3D starts from a known-good rollback base.** Freeze Stage-3C.1 app
  SHA-256 `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
  The Stage-3D pet plus current/average/high/low WPM and idle/sleep behavior is
  offline-built with ABI STATIC GO, then written/read back exactly and booted
  healthy. Runtime is partial/defective: screen/text rendered, the cat did not
  update, and one crash/watchdog reboot occurred after the first restart but
  has not repeated. The wrong-singleton lookup proves the no-update cause; the
  crash cause and an image-frame implementation remain open.

- **The logical screen is rotated.** The product is marketed as 310×100, while
  LVGL exposes 100×310. A centered 100×100 image consequently covers only the
  middle third (`y=105..204`). Stage 3E proved sprites live; Stage 3E.1's
  full-canvas correction is offline only.

- **Species switching stays local.** Stage 3E.2 uses Fn + bottom-knob handling
  in ID `7` vtable slot `9`, clockwise next and counterclockwise previous. The
  six-species choice is RAM-only and uses no global key hook. Its exact image is
  live-written/read back/boot-healthy, but runtime is a NO-GO. Sky-1 crosses
  `0x3C1D0000`, and all pets lie above that original mapped-page limit, exactly
  explaining the lower corruption and white squares. Stage 3E.3A places one
  static I4 cat below the limit; byte/boot evidence passes and visual acceptance
  is pending.

- **The F1 already tracks typing speed.** A native half-second loop computes an
  EWMA from completed words (Space key events) and stores the best `uint16`
  value under
  `wl_kb_stats/wpm_record`. The live backup's active record is 122 WPM, although
  no host RPC consumer is currently known. That record is not current WPM, and
  other keypresses count only as activity in the prototype, not as words.

- **The safest first write is smaller in scope, not necessarily smaller in
  file length.** Writing the complete app image at `0x10000` avoids touching NVS
  and filesystem partitions even though esptool erases/reprograms the sectors
  covering the app payload.

- **Backup and recoverability are separate properties.** A full flash dump is
  useful only if the ROM downloader remains reachable. The vendor's current
  entry command selects an app-resident USB/CDC flasher screen, and exhaustive
  firmware references found no alternate front-panel selector. A live filtered
  `usb-reset` probe also found no F1 serial port under normal firmware, only
  custom HID. A future safe-mode chord could help after app initialization;
  physical PCB GPIO0/BOOT plus reset/EN remains the recovery path for an app
  that cannot initialize.

## Glossary

### App image

The ESP32 executable image stored in the `factory` partition. For Framer 0.4.1
it begins at flash address `0x10000` and the extracted image is 1,960,000 bytes.

### DROM / IROM / IRAM / DRAM

ESP32 memory mappings. DROM contains mapped read-only data such as strings;
IROM contains mapped executable code; IRAM and DRAM are internal instruction
and data memory regions loaded or mapped by the image.

### Factory partition

The bootable application partition in this non-OTA layout. It is named
`factory`, begins at `0x10000`, and reserves `0x800000` bytes.

### Firmware widget

A device-resident controller/view registered in the keyboard firmware. This is
the project's final target.

### Host widget

A Mac process that owns state and sends transient display updates. The current
Pomodoro prototype is a host widget even though its output appears on the F1.

### Input

Work Louder's Electron desktop application. It provides configuration UI and
packages the private device SDK used for research interoperability.

### Input Lab

The separate extracted/rebuilt application used to prove that hidden catalog
cards can be rendered. It is not the signed production app and does not add
missing firmware capabilities.

### LittleFS / SPIFFS

Embedded flash filesystems. The partition subtype alone does not prove which
implementation the Framer mounts, so this project calls it the raw `fs`
partition until its format is verified.

### Merged firmware

A flash-addressed bundle that begins at offset zero and contains bootloader,
partition table, and app bytes. Do not write a merged file at the app partition
address.

### NVS

ESP-IDF non-volatile storage, commonly used for device settings, calibration,
pairing, or configuration. It is why the public firmware file alone is not a
complete personal-device backup.

### `knob_f1`

The Framer F1 device identifier found in Work Louder's SDK.

### `v.framer.bubble`

An undocumented Framer-specific RPC that shows or hides a short-lived label and
value overlay with an optional status dot.

### Validation hash

The SHA-256 digest appended to an ESP app image. It is separate from the SHA-256
used to identify the whole artifact file in manifests.

## Naming convention for future artifacts

Use names that state device, base version, stage, purpose, and image scope:

```text
framer-0.4.1-stage1-pomo-app.bin
framer-0.4.1-stage1-pomo-merged.bin
2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin
```

Never call an unflashed image “working,” and never call an app-only file a full
backup.
