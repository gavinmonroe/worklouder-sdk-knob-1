# Fast edit-to-device workflow

Version 0.3 separates an always-safe offline command from an explicitly
authorized device command. The goal is repeatable smoke tests in under ten
minutes without weakening device identity, recovery, or image-integrity gates.

## 1. Build and preflight

```sh
node f1-widget-sdk/bin/f1-widget.mjs combined
```

The command performs, in one process:

1. the frozen Stage-3E.3.4 48-frame I4 asset-page identity and hard end-address
   check below `0x3c1d0000`;
2. the owner-pinned WPM registration-only ABI, built from the unchanged full
   source while its standalone setup sections are discarded by the linker;
3. the Music ID1 registration ABI and the `controller+20 == registry`
   navigation gate in both modules;
4. one setup wrapper ordered as stock setup once, Music ID1, then WPM ID7,
   with stock-occupied ID8 rejected;
5. exact official 0.4.1, Stage-3C.1, live/readback Stage-3E.3A, corrected E3.4,
   pinned toolchain, and same-device full-recovery gates;
6. two deterministic links, mutation audit, ESP checksum/digest inspection,
   `esptool image-info`, and SHA-256 recording.

ABI and composite-app cache keys are independent. Editing I4 pixels does not
rerun an unchanged ABI audit. A cache hit still re-hashes every base, rollback,
asset, tool, output, and recovery input before reuse.

Current measured combined offline time on the development Mac is about 0.4
seconds cold; an unchanged build uses its verified cache and still rechecks the
base, recovery, output hashes, image checksum/digest, and `image-info`. These
are observations, not deadlines.

## 2. Promotion is separate

The older full-48 Stage-3E.3 scale-path run displayed its background, stars,
and labels but no pet. Its separate regression preflight still reports:

```text
RUNTIME_NO_GO_FULL48_PET_NOT_VISIBLE_2026_08_15
deployable: false
```

Do not turn that report into an approval. The corrected combined builder emits
`build/combined/combined-device-approval.draft.json`, but deliberately marks it
`AWAITING_MAIN_APPROVAL` and `hardwareWriteApproved: false`. The current
live-accepted app is 2,032,304 bytes with SHA-256
`bfce3956d144ffd6747ebd85f22bbfdb806dbced64afa7e3fee9ec2053c8f682`.
After independent approval, promotion creates a small approval file with this
exact shape:

```json
{
  "format": "framer-f1-device-candidate-v1",
  "status": "DEVICE_SMOKE_CANDIDATE",
  "target": {
    "device": "knob_f1",
    "firmware": "0.4.1",
    "chip": "ESP32-S3",
    "mac": "a4:cb:8f:af:32:10"
  },
  "write": {
    "offset": "0x10000",
    "scope": "factory-app-only",
    "hardwareWriteApproved": true
  },
  "app": {
    "bytes": 2032304,
    "sha256": "bfce3956d144ffd6747ebd85f22bbfdb806dbced64afa7e3fee9ec2053c8f682"
  },
  "rollback": {
    "sha256": "dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83"
  },
  "runtime": {
    "allAssetBytesBelow": "0x3c1d0000",
    "headroomBytes": 3220
  }
}
```

Release mode requires `DEVICE_RELEASE_CANDIDATE` instead.

## 3. Fast smoke mode

Input must be running with its localhost debugger, exactly as in the existing
recovery workflow. Then:

```sh
node f1-widget-sdk/bin/f1-widget.mjs deploy \
  --app path/to/candidate-app.bin \
  --approval path/to/device-candidate.json \
  --confirm-app-only
```

The SDK requires exactly one USB `knob_f1` on firmware 0.4.1, asks Input to
enter the bootloader, requires exactly one newly appearing USB serial port,
then independently verifies ESP32-S3, MAC `a4:cb:8f:af:32:10`, disabled Secure
Boot/Flash Encryption, and 16-MiB flash. It writes only the approved app at
`0x10000` using 921600 baud. The normal esptool write-hash verification must be
present in output. Watchdog reset boots the app, after which Input must report a
healthy USB `knob_f1` on 0.4.1.

Expected smoke time is about 1-3 minutes, dominated by bootloader transition,
write, and USB re-enumeration.

### First live fast-smoke result

The exact combined app SHA-256
`bfce3956d144ffd6747ebd85f22bbfdb806dbced64afa7e3fee9ec2053c8f682`
was written app-only at 921600 baud. Esptool reported its normal write-hash
verification, the write took about 15 seconds, watchdog boot succeeded, and
Input reported a healthy USB `knob_f1` on firmware 0.4.1. The final deployment
receipt is `build/device-receipts/device-1786888204784-fast-smoke.json`.
Focused combined build/test completed in under one second. WPM ID7 and Music
ID1 are physically accepted, including real title, artist, artwork, progress,
provider switching, and the WPM pet controls.

## 4. Release mode

```sh
node f1-widget-sdk/bin/f1-widget.mjs deploy \
  --app path/to/candidate-app.bin \
  --approval path/to/device-release-candidate.json \
  --full-readback \
  --confirm-app-only
```

Release mode keeps the device in ROM after writing, reads exactly the app byte
count back at the previously reliable 115200 baud, and requires byte equality
plus SHA-256 equality before watchdog boot. Expected time is about 4-8 minutes.

## Non-negotiable refusals

The device workflow has no option to write any address except `0x10000`, and
the invocation checker requires one filename only. It rejects `erase-all`,
`erase-flash`, `erase-region`, `--force`, encryption flags, and merged/full-
flash inputs. It never writes NVS, filesystem, coredump, bootloader, or the
partition table. It also refuses missing or changed same-device recovery data,
port ambiguity, approval-mode mismatch, and any target/rollback hash drift.
