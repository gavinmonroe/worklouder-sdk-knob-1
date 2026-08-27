# 2026-08-27 — id28 multi-widget (ONE WIDGET = ONE SCREEN)

The Widget Designer firmware: the MicroQuickJS v3 render pipeline with the
4-slot widget bank, one keyboard screen per stored widget (screens 28-31),
instant op-6 activation, tick-derived visibility, and the full event path
(ticks, keys, chords, fn+knob, host RPC) verified on hardware 2026-08-27.

| file | bytes | sha256 |
| --- | --- | --- |
| framer-0.4.1-mqjs-id28-multi-widget-app.bin | 2,062,912 | 01251fce47c3451172e8cd4c4f7da618136845f1278b0855c823d1c7b5d2a26c |
| mqjs-id28-text-page.bin (0x210000) | 131,072 | bac18adcb4402ccd4f250507541bcc9ad2ef95eb25ea35c8f6afe4c87a474ec2 |
| mqjs-id28-rodata-page.bin (0x230000) | 65,536 | f6c4dab4db51925bccc23aebe761a9471fc9ec553335c0aa68ee2d11bcd37d0f |
| scene-slot-b.bin (0x240000) | 95,599 | 599be673ca9aba43a1fc64ec73324137919df70d9475ff8477100aa57cf0008f |

Write order: scene slot B, text page, rodata page, app last (0x10000).
Source: psram-module-src/physical_integration.c at commit ce54a5c; built by
build-psram-module.mjs (blockBytes 31840, widgetUploadBlockBytes 1824).
Hardware acceptance: docs/17 + docs/18 §8 (3 widgets on 3 screens, live
values 1/s, input events end-to-end).
