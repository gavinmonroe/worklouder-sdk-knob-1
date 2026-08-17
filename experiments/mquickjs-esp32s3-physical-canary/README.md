# ESP32-S3 physical MicroQuickJS canary integration

This directory assembles the accepted blue clock/timer application, the
frozen MicroQuickJS engine, F2JS admission/owner, the weather target facade,
and a separate ID28 proxy into one deterministic, hardware-free candidate.

Run:

```sh
node experiments/mquickjs-esp32s3-physical-canary/verify.mjs
```

The verifier never opens a serial port and never emits a deploy command. Its
manifest remains `NO_GO` until every physical gate (including real F1 native
key-token identities and exact RPC delivery receipts) is independently
audited. Generated app/module/page files are evidence inputs, not permission
to flash.
