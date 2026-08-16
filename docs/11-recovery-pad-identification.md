# Physical recovery-pad identification appendix

This appendix is the conservative path to an application-independent ESP32-S3
ROM bootloader entry. It does **not** identify a Framer F1 PCB pad yet. No F1
schematic, boardview, or high-resolution PCB evidence is available in the
workspace, so the chip pin facts below are verified while the board routing is
unknown.

## Verified ESP32-S3 QFN56 pin facts

The numbers below use Espressif's **top-view** QFN56 orientation. Confirm the
package pin-1 marker and board orientation from clear photographs before using
the table; a rotated or bottom-view interpretation will identify the wrong
lead.

| QFN56 pin | Signal | Recovery relevance |
| ---: | --- | --- |
| `4` | `CHIP_PU` / `EN` | Active-low chip reset/enable input |
| `5` | `GPIO0` | Boot strap; hold low across reset for ROM download |
| `25` | `GPIO19` / USB D− | Native USB data; do not misidentify as BOOT/EN |
| `26` | `GPIO20` / USB D+ | Native USB data; do not misidentify as BOOT/EN |
| `52` | `GPIO46` | Boot strap; must be low or floating when GPIO0 is low |
| `57` | Exposed pad / GND | Ground reference; normally soldered beneath package |

GPIO0 has an approximately 45 kΩ internal pull-up. Espressif gives 10 kΩ to
ground as an example of a sufficiently strong external boot pull-down. GPIO0
must remain low while reset is released and for at least 3 ms after `CHIP_PU`
rises so the strap can be sampled. A reset pulse must keep `CHIP_PU` low for at
least 50 µs. `CHIP_PU` must not float, and GPIO46 must not be driven high during
download-boot selection.

Primary references:

- [ESP32-S3 series datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf)
- [Espressif boot-mode selection guide](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html)
- [ESP32-S3 schematic checklist and reset/strap timing](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html)

## What remains unknown on the F1

- No PCB test pad has been proven to route to QFN pin 4 or pin 5.
- The keyboard's power switch has not been proven to pull `CHIP_PU` low. Treat
  it only as a product power control until unpowered continuity proves more.
- Battery power may remain on internal rails after USB is unplugged or the
  external switch is moved. Do not infer an unpowered board from the display.
- No pad should be labeled BOOT, EN, or GND from location, shape, resistance,
  or a single visual trace alone.

## Conservative identification procedure

1. Unplug USB, switch the keyboard off, open it only with an appropriate
   nonconductive/ESD-safe setup, and disconnect the battery as soon as its
   connector is safely accessible. Do not work from the assumption that the
   power switch disconnects the battery or controls EN.
2. Photograph both PCB sides at high resolution before touching test points.
   Capture the QFN pin-1 marker, every nearby via/test pad, battery connector,
   USB connector, and power-switch routing. Keep an untouched photo and use a
   copy for annotations.
3. With USB and battery disconnected, use a meter first to confirm zero voltage
   between known board ground and every candidate. Establish ground from
   multiple independent points such as USB shield/ground and battery negative;
   verify continuity between them.
4. Orient the QFN from its physical pin-1 marker and Espressif's top-view
   drawing. Visually trace from pins 4 and 5 where possible. On the unpowered
   board, continuity-test candidate exposed pads to the intended signal with a
   microscope, insulated fine probes, and no chance of bridging adjacent leads.
   If the package leads cannot be contacted individually and confidently, stop;
   use better imaging, a fixture, X-ray/boardview evidence, or an experienced
   rework technician instead.
5. Check candidates against the known exclusions: USB D−/D+ route to pins
   25/26, and GPIO46 is pin 52. Record resistance/continuity values in both
   directions, the meter mode, exact pad photograph, and reference point. The
   expected GPIO0 pull-up is supporting evidence only, never sufficient proof.
6. Do not solder or apply power until a second independent review agrees on
   GND, GPIO0, and `CHIP_PU`. Never guess a pad, drag a probe across QFN leads,
   or probe adjacent QFN legs on a powered board.

## First no-write ROM-entry proof

Only after the pad routing is independently verified:

1. Reassemble enough of the power/USB path for controlled testing. Connect the
   verified GPIO0 point to verified ground with a deliberate boot pull-down;
   Espressif's example is 10 kΩ. Do not apply that resistor to an unverified
   pad.
2. Pull verified `CHIP_PU` low for at least 50 µs, then release it high while
   continuing to hold GPIO0 low for more than 3 ms. GPIO46 must remain low or
   floating.
3. Release GPIO0, enumerate serial ports, and run only `chip-id`, `read-mac`,
   and security-info reads. The MAC must be `a4:cb:8f:af:32:10`; any different
   result stops the experiment.
4. Perform no write. Exit with the verified `--after watchdog-reset` method and
   prove that the current Stage-1 app re-enumerates normally. Record photos,
   pad labels, resistance measurements, port, commands, and output.

This no-write round trip is the recovery gate. Merely finding continuity or
seeing a ROM port once is not enough; both manual entry and return to the
healthy app should be repeatable before Stage 2 or another crash-prone
behavior-changing image. Stage 3C was nevertheless written/read back exactly
and booted successfully without this physical route being demonstrated. That
successful boot does not weaken the recovery concern for a future image that
cannot initialize.

## Boot-failure escape

If a later custom app does not enumerate within its time-bounded first boot,
stop retrying it. Repeat the proven physical GPIO0/`CHIP_PU` sequence, identify
the same MAC, restore the official app-only 0.4.1 image at `0x10000`, read back
and compare the entire payload, then boot with `--after watchdog-reset`. Use the
full same-device backup only if app-only restoration is insufficient or a
non-app partition was knowingly changed. Exact commands are in the
[recovery runbook](./04-recovery-and-restore.md#app-only-restoration).

The two-Fn factory-reset chord is not an escape route: it erases NVS and reboots
the same application. The normal application's hidden Bootloader RPC is also
not an escape route because a nonbooting app cannot receive it.
