# Guarded physical MicroQuickJS canary workflow

Status: **static workflow PASS; no hardware access; no candidate is approved or
flashable until the final linker hashes, independent GO, key-token proof, and
physical GPIO0/BOOT recovery rehearsal all exist.**

This directory is the deployment boundary for the first boot-lifetime
MicroQuickJS canary. It does not build the firmware and it never treats a
filename as authority. Every app/page, report, recovery file, flash range,
method, event ID, input token, and confirmation is byte-pinned in one approval
document before a serial command can run.

Run the hardware-free verifier:

```sh
node experiments/mquickjs-device-canary-workflow/verify.mjs
```

The current result is `PASS_GUARDED_WORKFLOW_STATIC_NO_HARDWARE`. The synthetic
one-hour log proves the validator—not physical runtime behavior.

## Exact flash layout

The backed-up 16 MiB device has an 8 MiB factory partition at
`[0x10000,0x810000)`. The accepted healthy app is 2,062,912 bytes at
`[0x10000,0x207a40)` and its final erased sector ends at `0x208000`.

| Region | Range | Bytes | Policy |
| --- | --- | ---: | --- |
| candidate standalone app | `[0x10000,0x207a40)` | 2,062,912 | write **last** |
| erase-safe gap | `[0x208000,0x210000)` | 32,768 | untouched |
| module executable | `[0x210000,0x230000)` | 131,072 | write/readback first |
| module read-only data | `[0x230000,0x240000)` | 65,536 | write/readback second |
| slot B | `[0x240000,0x270000)` | 196,608 | untouched |

All three writes stay inside the factory partition and have non-overlapping
erase sectors. The partition table, NVS, filesystem, coredump, bootloader, and
slot B are never written. The final linker may change the module page hashes,
but it may not change these sizes/ranges without a new independently reviewed
workflow profile.

The canary uses one embedded, read-only, boot-lifetime package with exactly 16
handlers: eight weather host IDs, `tick.1s`, `tick.100ms`, Fn + bottom knob,
key down/up/hold, and chord down/up.
There is no runtime uploader, module rewrite, unmap, or package/NVS write. If
startup mapping or allocation fails, firmware must omit the capability, never
retry `esp_mmu_map` during that boot, and reboot/rollback. This avoids the
known IDF 5.3.2 first-map allocation-failure list-state hazard.

## Frozen recovery identity

- healthy app SHA-256:
  `363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32`
- healthy physical receipt SHA-256:
  `1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9`
- same-device 16 MiB recovery SHA-256:
  `aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd`
- target MAC: `a4:cb:8f:af:32:10`

Rollback writes only that healthy standalone app at `0x10000`, first and in a
ROM bootloader session. Once it boots, residual slot-A bytes are inert because
the healthy app never maps them. Erasing module pages is unnecessary and is
not implemented.

## Physical GPIO0/BOOT recovery gate

Do not approve a candidate based only on the working firmware's software
bootloader transition. Before any canary write, an operator must:

1. identify and photograph the PCB GPIO0/BOOT and EN/reset controls or test
   points;
2. with the healthy app still installed, rehearse entering ROM download mode:
   hold GPIO0 low, pulse EN/reset, then release GPIO0;
3. use read-only `chip-id`, `read-mac`, security, flash-size, partition-table,
   and app readbacks to confirm ESP32-S3, MAC `a4:cb:8f:af:32:10`, 16 MiB,
   security disabled, and the frozen partition/app hashes;
4. reset without writing and confirm the healthy app returns;
5. record the physical evidence and operator in the approval.

If GPIO0/BOOT or EN cannot be reached and rehearsed independently of the app,
the result is NO-GO. A black screen, absent capability, unexpected reset,
readback mismatch, mapping error, or WDT event means stop; do not retry module
mapping or write flash from the running app. Enter ROM physically and restore
the healthy app first.

## Preparing an approval

`prepare-approval.mjs` requires final artifacts and two machine-readable proof
documents. It derives exact app diff ranges, validates ESP checksum/appended
SHA and unchanged six-segment layout, pins every embedded package, and refuses
to overwrite an approval file.

```sh
node experiments/mquickjs-device-canary-workflow/prepare-approval.mjs \
  --candidate-app /absolute/final-canary-app.bin \
  --module-text /absolute/final-module-text-page.bin \
  --module-rodata /absolute/final-module-rodata-page.bin \
  --link-report /absolute/physical-link-report.json \
  --audit-report /absolute/independent-audit.json \
  --key-proof /absolute/key-token-proof.json \
  --canary-package /absolute/combined-id28-canary.f2js \
  --weather-facade /absolute/weather.f2tf \
  --weather-base /absolute/weather-base.lzss \
  --operator "operator name" \
  --physical-recovery-evidence "photo/log reference and rehearsal time" \
  --out /absolute/mquickjs-canary-approval.json
```

The link report must have `verdict: "GO"` and pin
`candidateAppSha256`, `moduleTextSha256`, `moduleRodataSha256`, and the full
`moduleSlotSha256` over exactly padded `[0x210000,0x240000)`. Both link and
independent audit must also pin
`allocationMapOrdering: "internal-block-before-first-mmu-map-adopt-or-rollback-v1"`,
the coherent telemetry/UI-latency protocols, and the exact normalized key proof.
The key proof includes
`keyNegativeHarness: "low24-e5-observed-never-mapped-pass-v1"` in both reports.
The independent report format is
`framer-f1-mquickjs-physical-link-audit-v1`; it must independently pin
the candidate, link-report, both module pages, and key-proof hashes.

### Key proof

The required fixed proof is logical key 0 = HID Space token `44`, logical key
1 = Left Shift token `225`, exact chord held-mask `3`. The proof JSON format is
`framer-f1-mquickjs-key-token-proof-v1` and pins the accepted-app callback span,
callback literal, both relevant instruction hashes, the two mappings, and
`postFlashObservationRequired: true`. Stock receives the original raw value
first; only afterward JavaScript ingress normalizes `raw & 0x00ffffff` under
`raw-low24-after-stock-first-v1`. Right Shift low24 token `229` is explicitly
rejected, so the stock callback's unrelated mask cannot broaden the JS map.

Even with static proof, key JavaScript remains disabled on boot. With screen 28
foreground, the operator must press/release Space and Left Shift and the device
must observe the exact two values before advertising `keyEvents: true`.
Synthetic SDK fixtures `0x10203040` and `0x50607080` are always rejected.
If this exact proof does not land, approval fails closed and the canary may not
advertise key or chord support.

## Offline preflight and guarded write

Offline preflight reads no device:

```sh
node experiments/mquickjs-device-canary-workflow/deploy.mjs preflight \
  --approval /absolute/mquickjs-canary-approval.json
```

It prints approval-bound flash and rollback tokens. The write mode additionally
requires an explicit ROM port, a new output directory, `--execute`, and the
exact token. Before writing it checks chip/MAC/security/flash size, reads the
partition table and healthy app, and seals local artifact copies. Each module
page is read back byte-for-byte before the next write; the app is written last
and read back before reset. A durable journal records progress and pre/post
hashes.

```sh
node experiments/mquickjs-device-canary-workflow/deploy.mjs flash \
  --approval /absolute/mquickjs-canary-approval.json \
  --port /dev/cu.usbmodemEXACT \
  --out /absolute/new-canary-flash-receipt-directory \
  --confirm FLASH_MQUICKJS_CANARY_A4CB8FAF3210_<APPROVAL_PREFIX> \
  --execute
```

The command is intentionally unusable until the complete approval validates.
No command in this directory enters the bootloader through the running app.
The operator must explicitly provide the already-confirmed ROM port.

Guarded rollback is symmetric but writes only the healthy app:

```sh
node experiments/mquickjs-device-canary-workflow/deploy.mjs rollback \
  --approval /absolute/mquickjs-canary-approval.json \
  --port /dev/cu.usbmodemEXACT \
  --out /absolute/new-rollback-receipt-directory \
  --confirm RESTORE_HEALTHY_APP_A4CB8FAF3210_<APPROVAL_PREFIX> \
  --execute
```

The esptool guard rejects erase, force, encryption, merge, multi-image writes,
wrong chips/ports/offsets/files, and any region not sealed by the approval.

## Capability, RPC smoke, and one-hour soak

Generate the exact no-I/O action plan after approval:

```sh
node experiments/mquickjs-device-canary-workflow/smoke-plan.mjs \
  --approval /absolute/mquickjs-canary-approval.json
```

It covers screens 1, 7, 26, 27, and 28; key down/up/hold; chord down/up;
key-held + bottom-knob rotation; native 100 ms and 1 s ticks; all weather IDs
`0xB240..0xB244`, `0xB24D..0xB24F`; atomic weather revision 18;
hidden/resume; last-good preservation; and canary-only OOM/timeout recovery.
There is no undeclared `0x7001`, `0x7FFE`, or `0x7FFF` handler. Fault injection
uses reserved B24D sentinels and terminal `F` receipts.

The exact methods are `widget.mquickjs.cap`, `widget.mquickjs.telemetry`,
`widget.mquickjs.event`, and `widget.mquickjs.receipt`. Device replies contain
exactly `{status:"..."}` with an ASCII value no longer than 112 bytes.
Capability is 13 pages and telemetry is six compact pages. A host sends only
one event at a time, requires its initial `Q`, and polls the receipt method
until the same sequence and fields reach `A` or the expected canary fault `F`.
Telemetry page 0 locks one cached sample; exact ordered pages 1 through 5 read
that sample, and page 5 clears it. Duplicate, out-of-order, or expired sessions
reject and clear. Both the link report and independent audit must pin
`p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1`; this prevents 100 ms owner
updates from tearing a six-page host snapshot.

Capability page 1 reports `baseApp=36317013...`, meaning accepted healthy-app
ancestry. It does not claim the running candidate's impossible self-hash. The
candidate app identity comes only from the approval-bound full esptool
readback receipt. Page 2 reports SHA-256 over the complete 196,608-byte module
slot (`0x20000` padded text followed by `0x10000` padded rodata).

The RPC/HID runner writes raw JSONL records with only two kinds: `rpc` for
verbatim request/device-response pairs, and `observation` for explicitly
external operator/camera screen or physical Right Shift evidence. The host may not synthesize rich
device capability or telemetry fields. Feed that log and the exact completed
flash receipt to:

```sh
node experiments/mquickjs-device-canary-workflow/soak.mjs \
  --approval /absolute/mquickjs-canary-approval.json \
  --flash-receipt /absolute/new-canary-flash-receipt-directory/flash-receipt.json \
  --input /absolute/one-hour-telemetry.jsonl \
  --out /absolute/mquickjs-one-hour-soak-receipt.json
```

The one-hour gate requires samples no more than 10 seconds apart, one stable
boot token, exact base ancestry/module/package identities, the approval-bound
candidate readback receipt, a 65,536-byte heap limit, at least 2 KiB stack
remaining, a 2 ms callback deadline, owner slices no longer than 8 ms, no heap
leak over 2 KiB, no queue/fatal/recovery failure, a fully applied final mailbox
revision, exact device receipts, four observation-only Space/Left Shift discovery
edges followed by a real JS Space dispatch, exact accepted tokens 44 and 225,
and a physical Right Shift press/release observed as low24 229 without JS callback
admission, combined with the link-audited equality-only 44/225 mapper and explicit
229 negative harness (timer callbacks may legitimately advance during the action).
It separately requires atomic VM/mailbox and visible F2TF
weather revision, a nonzero full ID28 proxy-tick maximum no greater than 100 ms,
and recovered OOM + timeout with last-good state retained.
The canary honestly reports WDT `unsubscribed`; this workflow does not promote
that into a watchdog-lifecycle proof.

Only a resulting `PASS_PHYSICAL_MQUICKJS_ONE_HOUR_CANARY_SOAK` receipt can
promote the external evidence. The device itself continues to advertise
`physical=1`, `proven=0`, and `uploader=0`; Package Push remains blocked. This
is not a production uploader or broad MicroQuickJS SDK release.
