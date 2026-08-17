# Keyboard-editable ZIP for the ID28 weather widget (plan, agreed 2026-08-17)

Decision: the ZIP is **stored on the host** (Input Lab config); the keyboard is the
**editor**. The device cannot fetch weather itself and the module contract forbids
flash/NVS writes, so device-side persistence buys nothing.

## Interaction (defaults; confirm with Gavin)
- Enter settings: long Fn + bottom-knob press while ID28 is visible.
- Card switches to `ZIP 6 0 6 0 1` with one digit highlighted (facade digit
  formatter; highlight via a second target or inverse box in the base raster).
- Knob turn: change highlighted digit 0..9. Knob click: advance to next digit.
- Long-press on last digit: save. Short-press elsewhere / timeout 30 s: cancel.
- After save the card shows `Saved…` until the host pushes fresh weather.

## Pieces
1. **JS (weather-widget.js gen 20)** — settings state machine on top of the
   existing 16 handlers (`input.fn-bottom-knob`, `input.key.*`, ticks). Writes the
   edited ZIP into two spare mailbox slots (e.g. slot 14/15 → hi/lo digits) plus a
   "pending save" flag. Keep 16 handlers / 2 keys / 1 chord so admission metadata
   is unchanged. Facade (.f2tf) gains the settings-mode targets (16-target cap;
   currently 12 live + 4 no-op → reuse the 4 no-ops).
2. **Module (small C)** — one read-only telemetry/cap page that exposes the 16
   mailbox int slots (device→host value channel does not exist today).
   Rebuild via `build-psram-module.mjs` (+ `FRAMER_DIAG_ASSETS_DIR`), 3-region flash.
3. **Host** — `f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/host-adapter.mjs`
   + Input Lab: poll the new page (~1 s while the widget flags "pending save"),
   persist `postalCode` in Input Lab config, refetch (wire the real provider —
   verify which provider Input Lab uses; the example ships a deterministic one),
   push fresh events; on boot, push the saved ZIP back so the widget shows it.
   Lift the "physical delivery restricted to 60601/CHICAGO" guard in
   `input-lab/app.mjs` (~line 894/923) — the redesign has no place label.
4. **Tests** — simulator cases for the state machine; facade pixel-exact cases for
   the settings frame; host adapter unit test for the poll/persist loop.

## Constraints learned today (do not relearn)
- Key gate delivers only Space(44)/LeftShift(225) to JS → knob-driven entry.
- Facade text = 5×7 bitmap font, scale ≤3, closed formatter set, no free strings.
- Stop `npm run media:live` before any RPC push/smoke (shares the transport).
- Every flash: pages first (0x210000 text, 0x230000 rodata), app last (0x10000),
  fast-diff app-only mode when only the app changed.

Estimate: ~half a day of agent work + 2 flashes.
