# Reverse-engineered contracts

These are facts pinned to one exact binary and one research history, not a
stable vendor API.

| Contract | Pinned value |
|---|---:|
| Firmware target | Framer F1 `0.4.1` |
| Logical LVGL canvas | `100x310` |
| Physical/marketed orientation | `310x100` |
| Custom screen ID | `7` |
| Factory app flash offset/capacity | `0x10000` / `0x800000` bytes |
| Segment count | 6 |
| DROM mapping / Stage-3C.1 end | `0x3c120020` / `0x3c1c1190` |
| IROM mapping / Stage-3C.1 end | `0x42000020` / `0x42116f10` |
| Setup pointer app offset / original target | `0x8c194` / `0x42116da4` |
| Native WPM float | `0x3fcaba20` |
| Stock key callback | `0x4206eae0` |
| Stock native WPM tick | `0x4206ed14` |
| Stock Timer remaining getter | `0x421084f4` |
| LVGL image descriptor | 24 bytes |
| Flash/MMU mapping page | `0x10000` bytes |

The controller is a 208-byte screen-local object with an eleven-entry vtable at
`+160`, root at `+12`, build slot 1, cleanup slot 4, 100-ms UI slot 6, screen ID
slot 8, and input slot 9. Images and labels are controller-root children.
Cleanup clears borrowed pointers after recursive root deletion.

## Exact WPM roster layout

- Draw order: `sky`, selected pet, WPM label, analytics label.
- Sky: exact logical `100x310`, CENTER.
- Pet: normalized `68x56`, CENTER.
- WPM: TOP_MID, `x=0`, `y=3`.
- Analytics: BOTTOM_MID, `x=0`, `y=-3`, `Avg ###\nTop: ###`.
- Descriptor order: `sky-0`, `sky-1`, then `species * 8 + state`.
- State order: ready, curious, happy, zooming, fire, tired, waiting, sleeping.
- Input: screen ID 7 local, hold Fn and turn bottom encoder ID 1; clockwise
  next, counterclockwise previous, wrap; RAM-only selection resets on reboot.
- Stock key callback, WPM tick, and Timer getter remain byte-preserved.

## Image evidence boundary

The live-visual Stage-3E reference used two 100x100 skies and eight 68x56 cat
frames. Its native bank is 60,944 bytes, SHA-256
`db51e51c3aff251f0536eadd3522c467e11ae5714f92ce361ac901a3b3f5fab4`,
ending at `0x3c1cffa0`, 96 bytes before `0x3c1d0000`.

Stage-3E.2 is live boot/read-back/health proven but visually defective. Its
`sky-1` payload crosses `0x3c1d0000`; all pet pixel payloads begin beyond that
boundary. The observed corruption correlates with this transition, but the SDK
does not call it the root cause. Full-canvas and multi-page image use remain
unapproved until a narrowed experiment proves and guards the fix.

Every build re-audits pinned wallpaper/image instruction windows, controller
lookup, Input converter hashes, exact Stage-3E reference bytes, and the final
firmware mutations. Firmware drift requires new reverse engineering.
