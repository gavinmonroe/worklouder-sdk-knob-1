# Stage-2 native bridge candidate appendix

This appendix preserves the current exact byte-level candidate for bridging the
Framer Timer view to its linked but unwired Pomodoro-like state machine. It is
an analysis artifact, **not an approved firmware image**.

## Certainty and expected behavior

- **High static confidence:** the dormant object, field layout, timer routines,
  visible Timer call paths, candidate instruction boundaries, and available
  in-place byte budget are supported by offline Xtensa analysis.
- **Medium runtime confidence:** the guarded repository builder and structural
  tests pass and the independent static audit is GO, but the adapter has not
  been flashed or invoked on the physical F1.
- **Recovery status:** blocked until physical PCB GPIO0/BOOT plus reset/EN is
  located and live-verified. Static analysis ruled out a front-panel path, and
  a live filtered `usb-reset` probe found no F1 serial port under normal
  firmware, as described in
  [the recovery runbook](./04-recovery-and-restore.md#critical-limitation-of-the-current-entry-method).

If the static model is correct, the candidate produces four cycles of
25-minute work and 5-minute rest using the latent firmware timer. The visible
heading is `Focus` and remains static during the rest phase in this first
bridge. Session state is RAM-backed and resets on reboot; persistence across a
power cycle is not part of this candidate.

### Known candidate limitations

- The rest-phase numeric countdown is expected to be correct from `05:00`, but
  the ring still uses the 1500-second work duration as its denominator. It
  therefore begins a break around 20% filled instead of treating 300 seconds as
  a full ring.
- The heading remains `Focus` during breaks; no dynamic `Break` heading is wired.
- There is no added focus/rest transition notification, sound, or beep.
- State is RAM-only and resets to defaults across reboot or power loss.
- All screen, button, timer, and transition behavior remains runtime-unproven
  until tested on the F1.

## Why a getter swap is unsafe

Nomad contains a distinct Pomodoro UI/controller that is absent from the
Framer. Framer's visible Timer object and dormant Pomodoro-like object have
different layouts and helper expectations. Redirecting only the Timer getter
would make callers read incorrect fields and dispatch incompatible methods.

The candidate therefore uses explicit adapters. It reuses an old Timer getter/
constructor body that becomes unreachable, providing a code cave from
`0x42026138` through `0x42026172`. It keeps all ESP image segment sizes fixed.

## Dormant Framer object model

| Item | Address or field offset |
| --- | --- |
| Singleton BSS object | `0x3FCAE1E8` |
| Constructor | `0x4202BB54` |
| Getter | `0x4202BBAC` |
| App-init getter/reset call | `0x4202C058` |
| Native concrete reset | `0x4201A968` |
| Phase transition | `0x4201A984` |
| Tick/decrement | around `0x4201A9CC` |
| Remaining seconds | object `+28` |
| Pause flag used by adapter | object `+32` |
| Current cycle | object `+34` |
| Target cycles | object `+35`, initialized to `4` |
| Work duration | object `+36` |
| Rest duration | object `+40` |
| Mode | object `+44` |

## Exact candidate patch map

Every offset below is a **merged-file offset** into exactly this pinned base:

```text
c8926bd181bc06062d8c79221c6bb1c7f85463f0034444f263e1995cb383b976
```

The builder checks the byte counts, pinned source hash, and exact original bytes
at every range before emitting the candidate. Independent review subsequently
verified the instruction/control-flow and caller/field-adapter model.

| Merged offset | Bytes | Purpose | Replacement hex |
| ---: | ---: | --- | --- |
| `0x15AE0` | 6 | Visible heading `Focus` | `466f63757300` |
| `0xE612C` | 71 | Simple-getter wrapper; fixed `1500`/`300` start adapter at VA `0x42026138`; status adapter at `0x4202615C` | `364100e5a7052d0a1df0000032a5dc3972399282a12c89a20c0882422082422289b2c1fb6cb1006da2c214a594f41df03641008202208c280c221df088b20c126628010c021df0` |
| `0xDA9FC` | 16 | Pause: stop timer subobject and set object `+32` to `1` | `364100a2c214a5feff0c188242201df0` |
| `0xDAA10` | 10 | Reset: delegate to native concrete reset `0x4201A968` | `364100ad0225f5ff1df0` |
| `0xDAAC0` | 6 | Start: entry and jump to adapter `0x42026138` | `364100469c2d` |
| `0xDAAE0` | 22 | Resume: clear object `+32` and restart at 1 Hz | `3641000c08824220c1959ab19a9aa2c214e5faff1df0` |
| `0x1C84EC` | 7 | Initial-duration getter: read work-duration `u32` at object `+36` | `36410028921df0` |
| `0x1C84F4` | 7 | Remaining getter: read remaining `u32` at object `+28` | `36410028721df0` |
| `0xC1EE0` | 4 | Redirect status-function literal to `0x4202615C` | `5c610242` |

After those changes and normal ESP app-integrity repair, the proposed output
has:

| Integrity item | Candidate value |
| --- | --- |
| ESP checksum byte at merged `0x1EE81F` | `0x8E` |
| Appended app digest | `34cc73c5a3465420907b6b765ef9266a483330063b543ce27044212629de3d7e` |
| Resulting app-file SHA-256 | `c61b6e2da9cac2d397bcde2cdcf7850d3fbf4a1daad44db0e8f412df39c9552c` |
| Resulting merged-file SHA-256 | `461e86542b80dbf34c830c768b764195ae8fe1b0d9bf6fbdf14154cc85828c77` |

The main patcher reproduces these values and its tests reject undeclared byte
changes. This is deterministic offline evidence, not runtime proof.

## Required audit before implementation

Completed offline:

- Assert the pinned source hash and exact original bytes for all nine ranges.
- Build from a deterministic script rather than applying this table manually.
- Preserve app/segment sizes and repair/validate image checksum and digest.
- Verify the independently derived output hashes and declared changed ranges.
- Independently disassemble all nine replacements and verify their call/jump
  targets, register/return shape, alignment, and bounded control flow.
- Verify the code cave is unreachable through its old path after rerouting.
- Verify the Timer-facing adapters use the intended dormant fields and do not
  expose the incompatible object layout directly.
- Complete a separate static review: **GO**, with no static crash defect found.

Still required:

1. Pass the physical GPIO0/BOOT plus reset/EN recovery gate; the full-backup
   gate now passes.
2. Flash app-only and read it back byte-for-byte.
3. Prove normal boot, USB/HID, existing widgets, and the visible `Focus` screen.
4. Exercise start, pause, resume, reset, work-to-rest, rest-to-work, and four-
   cycle completion behavior on hardware.
5. Confirm the documented ring/heading/sound/persistence limitations at runtime.

The first runtime test should use a shortened development duration only if the
builder generates and records a separate hash-pinned image. The canonical
candidate above remains 1500/300 seconds.
