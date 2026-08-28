# Knob 1 firmware RPC surface

Knob 1 firmware `0.4.1` answers 36 RPC methods. Twelve are in wl-device-kit 0.1.28; the
rest are not, and several are useful reads that no shipped tool exposes.

The authority here is the device's own flash, not the Input app and not the SDK. Both of
those show a documented subset — `v.framer.bubble`, for instance, appears in neither.

## Extracting the table

From a full-flash capture (see [docs/22](./22-app-independent-bootloader-entry.md)):

```sh
python3 -c "
d = open('full-flash-16mb.bin','rb').read(); a = d[0x10000:0x810000]
e = len(a)
while e > 0 and a[e-1] == 0xff: e -= 1
open('knob1-app.bin','wb').write(a[:e])"

strings -n 3 knob1-app.bin |
  grep -E '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$' | sort -u
```

The app partition trims to 1,960,000 bytes. **The first segment must be allowed to be a
single character** — an earlier pass required two or more and silently dropped every
`v.*` method, including `v.framer.bubble`.

## The methods

In the SDK: `sys.version`, `sys.bootloader`, `sys.selftest`, `device.status`, `fs.list`,
`fs.read`, `fs.readbin`, `fs.write`, `fs.writebin`, `fs.delete`, `host.focused_app`,
`ui.home_accent_color`, `alert.generic`.

Not in the SDK:

| Method | Notes |
| --- | --- |
| `ui.wallpaper_list` | pager: `offset`, `limit` -> `total`, `offset`, `items` |
| `ui.wallpaper_select` | takes `name`; errors `Missing name param`, `unknown wallpaper` |
| `ui.wallpaper_background` | `grad_top`, `grad_bottom`, `active` |
| `sentry.get` | RTOS diagnostics snapshot |
| `sentry.crash`, `sentry.coredump`, `sentry.coredump_erase` | crash reporting |
| `sys.charger_diagnostic` | takes a `category` |
| `sys.charger_diagnostic_summary` | own handler `rpc_on_charger_diagnostic_summary` |
| `fs.chksm` | takes `file` -> `size`, `checksum` |
| `fs.format` | **destructive** |
| `kb.cs.show`, `kb.cs.hide`, `kb.cs.toggle` | cheat sheet |
| `kb.sa.exec`, `kb.sa.inserttext`, `kb.sa.openapp`, `kb.sa.openurl` | smart actions |
| `v.framer.bubble` | handler `rpc_on_framer_bubble`, log `framer_bubble: l='%s' v='%s' d=%d s=%d` |
| `v.framer.hid` | no `rpc_on_` symbol; adjacent to `PUBLISH` and `KV_FRAMER_PUBLISH` |

`power.max77972.summary` and `power.max77972.register_dump` look like methods in a plain
string dump but are **not**. They sit beside `category` and the charger handlers, and
`sys.charger_diagnostic_summary` returns `"category": "power.max77972.summary"` — they are
category values.

`v.framer.bubble` **is** present on a Knob 1. `f1-cli` still restricts the bubble to
`knob_f1`, which is conservative rather than required; it has not been tried on a Knob 1.

## `probe`

The four methods below are reachable through `f1-cli probe`. They are held in
`FIRMWARE_PROBE_METHODS`, separate from `READ_ONLY_RPC_METHODS` and off unless `probe`
turns them on, because the audited set is documented as reviewed against the SDK and these
methods are not in the SDK. `inspect` and `backup` still refuse them.

```sh
sudo node bin/f1-readonly.mjs probe --file keymap.json
```

`sudo` is needed on a Knob 1 ([docs/21](./21-knob1-macos-hid-access.md)).

Observed on firmware `0.4.1`:

```json
"ui.wallpaper_list":  { "total": 0, "offset": 0, "items": [] }
"fs.chksm":           { "size": 2307, "checksum": "6e3e42b7...c142e243" }
"sys.charger_diagnostic_summary": { "status": "ok", "category": "power.max77972.summary" }
```

`fs.chksm` returns the same checksum `fs.list` reports for the same file.

`sentry.get` returns `uptime`, `uptime_ms`, `cpu_freq`, `heap_size`, `heap_free`,
`heap_min_free`, `cpu0_usage`, `cpu1_usage`, and a `tasks` array of
`{name, runtime, usage, priority, core, stack_min}`. A healthy unit reports 240MHz, a
2,378,919-byte heap with ~2,008,000 free and ~1,985,000 minimum free, and 16 tasks:
`wl_lights`, `wl_lvgl`, `esp_timer`, `wl_io`, `wl_tsk`, `wl_comms`, `wl_kmx`, `wl_rpc`,
`wl_ble`, `nimble_host`, `btController`, `TinyUSB`, `sys_evt`, `ipc0`, `ipc1`, `Tmr Svc`.
So the display is LVGL, Bluetooth is NimBLE, and USB is TinyUSB. `heap_min_free` is the
number to watch when judging headroom for a custom widget.

## Deliberately excluded

| Method | Why |
| --- | --- |
| `sys.selftest`, `sys.charger_diagnostic` | may actuate hardware |
| `sentry.crash`, `sentry.coredump_erase` | trigger or destroy state |
| `sentry.coredump` | semantics unclear |
| `ui.wallpaper_select`, `ui.wallpaper_background`, `ui.home_accent_color` | change what the device displays |
| `fs.format`, `fs.delete`, `fs.write`, `fs.writebin` | destructive |
| `v.framer.hid` | unknown; no handler symbol |
| `kb.*`, `alert.generic`, `mp.*` | device-to-host notifications, not calls |

Read-only status for the four probed methods is inferred from the firmware's dispatch
tables and confirmed by their responses. It is not the SDK audit that
`READ_ONLY_RPC_METHODS` rests on, which is why they are kept apart. Do not fold them in
without disassembling the handlers.

## Other strings of note

`alert.generic` carries `TIMER_END`, `POMODORO_WORK_END`, `POMODORO_BREAK_END` and
`wpm_record`, so Pomodoro and WPM alert plumbing already exists in stock firmware.

Keycodes include `KV_FRAMER_AI`, `KV_FRAMER_PUBLISH` and `KV_OAI_ACT00`-`ACT19`, alongside
`KI_BLDW`/`KI_BLUP` backlight, `KI_LS1`-`6` layer select, `KI_PS1`-`6` profile select, and
`KI_CBT1`-`3`/`KI_CBTP1`-`3` Bluetooth channels.

`device.status` reports `profile_index`, `layer_index`, `is_charging`. Reset reasons are
`poweron`, `panic`, `int_wdt`, `task_wdt`, `brownout`, `deepsleep`, `sdio`. The charger is
a MAX77972 with states `prequal_trickle`, `fast_charge_cc`, `fast_charge_cv_or_topoff`,
`charge_done`, `timer_fault`, `thermal_shutdown`, `reverse_boost`, `watchdog_fault`.
