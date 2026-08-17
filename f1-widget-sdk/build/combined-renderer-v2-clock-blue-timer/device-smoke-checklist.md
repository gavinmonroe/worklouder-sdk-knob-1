# Render-v2.1 blue timer guarded device smoke

Frozen candidate:

- app: 2,062,912 bytes, SHA-256 `363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32`
- module: 23,700 bytes, SHA-256 `4521408133f1f84c04312312a9a1baddac1c75ec0795ea4b12f69e222389e29a`
- generation-2 package: 95,535 bytes, SHA-256 `5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7`
- immediate rollback: 2,062,912 bytes, SHA-256 `7838eea09b7e712a76cbdb5786efa3752079a852aa0bcad49d4cd8c596b070e5`
- rollback receipt: 2,403 bytes, SHA-256 `792f03f487d062d25d340b52b16b7e820592bb6b1c2f66f2824a83056bd0e5e0`

Before touching the device:

1. Require all offline tests and the independent firmware audit to be green.
2. Stop the live media runner so it cannot hold the Input USB transport.
3. Leave exactly one USB Framer F1 connected and keep Input running.
4. Do not run any erase, merged-image, full-flash, or unpinned command.

Exact app-only flash command:

```sh
node /Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/f1-widget-sdk/bin/f1-widget.mjs deploy --app /Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin --approval /Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/combined-renderer-v2-clock-blue-timer-device-approval.draft.json --rollback /Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/f1-widget-sdk/build/rollbacks/framer-0.4.1-live-7838eea0-clock-timer-app.bin --confirm-app-only
```

Require `Hash of data verified`, a healthy USB `knob_f1@0.4.1` post-boot report, and a new deployment receipt before continuing.

Exact one-shot package provision command:

```sh
node /Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/f1-widget-sdk/examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs --confirm-live-rpc
```

Require `FOCUS_TIMER_PACKAGE_COMMITTED`, generation 2, 95,535 bytes, 32 chunks, and package SHA-256 `5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7`.

Exact read-only RPC smoke command:

```sh
node /Users/gavin/Documents/ChatGPT/worklouder-sdk-knob-1/f1-widget-sdk/examples/render-v2-focus-timer/tools/post-flash-rpc-smoke.mjs --confirm-live-rpc
```

Require `POST_FLASH_RPC_SMOKE_OK` and exact status-only scene acknowledgment.

Manual acceptance:

- ID1 still renders live music metadata, artwork, and progress.
- ID7 still renders WPM Pet.
- ID26 is orange, its top text is 4 px lower, its clock follows the device RTC, and its five-position dial advances once per second.
- ID27 is dark sky-blue, its top text is 4 px lower, and its five-position dial advances once per second.
- Fn + bottom dial changes ID27 immediately in five-minute steps and the dial moves with each detent.
- ID27 countdown pauses while hidden and resumes from the same remaining time.
- Navigation across IDs 1, 7, 26, and 27 remains responsive with no black frame or stale pixels.

After acceptance, restart the live media runner. If any flash, provision, RPC, or visual check fails, stop and retain the exact `7838eea0` rollback plus its `792f03f4` physical receipt; do not improvise a destructive recovery command.
