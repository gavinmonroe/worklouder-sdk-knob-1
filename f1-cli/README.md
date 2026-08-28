# Framer F1 read-only CLI

This is a deliberately small investigation tool for the Framer F1, which the
extracted Work Louder SDK identifies as `knob_f1`. It loads SDK version `0.1.28`
from `../extracted/input-app` without changing that extraction.

Persistent device writes remain unavailable. A transport guard permits the
audited read methods plus one explicit transient exception: `v.framer.bubble`
on `knob_f1`. Firmware flashing, app installation, deletion, and all filesystem
writes are refused before they can reach HID. Inspection and backup transports
do not enable even the bubble exception.

Requires Node.js 18+ and the extracted Input app in the repository's existing
`extracted/input-app` location. Quit the Input app before connecting so the two
programs do not contend for the keyboard. On macOS, run the terminal from an app
that has Input Monitoring permission.

```sh
cd f1-cli
npm run self-test
npm test

# Discovery and permission check only; never opens the keyboard.
node bin/f1-readonly.mjs inspect --discover-only

# Read version, status, recursive file list, and current screen.
node bin/f1-readonly.mjs inspect

# Also read active and installed firmware app lists. This is useful for checking
# whether Pomodoro or Media Player exist but are hidden from the Input UI.
node bin/f1-readonly.mjs inspect --apps

# Read every listed device file into a new local directory plus manifest.json.
# The destination must not already exist, preventing accidental overwrites.
node bin/f1-readonly.mjs backup --output ./backups/f1-before-experiments

# Validate and show the exact JSON-RPC request without discovery, SDK I/O, or HID.
node bin/f1-readonly.mjs bubble \
  --label "Input Lab" --value "Custom bubble proof" --dry-run

# Send the transient display bubble to exactly one attached Framer F1.
# Defaults to a visible bubble with its 8x8 status dot enabled (d=1, s=1).
node bin/f1-readonly.mjs bubble \
  --label "Input Lab" --value "Custom bubble proof"

# Hide the bubble and its status dot immediately.
node bin/f1-readonly.mjs bubble \
  --label "Input Lab" --value "Hide" --d 0 --s 0
```

## Knob 1 on macOS

The Knob 1 (`deviceType: "knob"`, PID `0x8296`/`0x82e3`) is discovered by default
alongside the Framer F1, but macOS denies HID output reports to it, so every RPC fails
with `Cannot write to hid device` until the command is re-run with `sudo`. The cause,
the measured `IOReturn` codes, and a reproduction script
(`tools/macos-hid-probe.py`) are in
[`docs/21-knob1-macos-hid-access.md`](../docs/21-knob1-macos-hid-access.md).

The transient display bubble remains Framer-F1-only; it is a display RPC that has not
been exercised on a Knob 1.

If multiple matching keyboards are attached, add `--device 0` (or the index
shown by `inspect --discover-only`). `--all-devices` opts into inspecting other
recognized Work Louder models; the default is strictly `knob_f1`. Add `--json`
for explicitly machine-oriented output.

`backup` only reads the keyboard. It saves raw bytes locally, records the SDK's
reported size/checksum, and adds a local SHA-256 for each copied file. A partial
backup exits with status 3 and records failed files in the manifest.

The compact firmware payload is sent exactly as `{ l, v, d, s }`. `l` and `v`
are required nonempty strings capped at 32 and 64 UTF-8 bytes. `d` and `s` are
numeric u8 booleans, so only `0` and `1` are accepted. `s=1` shows/enables the
bubble and `s=0` hides it; `d=1` shows its 8x8 status dot and `d=0` hides the
dot. The visible defaults are `d=1,s=1`. Every call refreshes the firmware's
hardcoded 10-second bubble TTL.

There is intentionally no force flag or persistent-write bypass. A later
experimental widget installer should be a separate tool and should only be
built after a known-good backup, file-format analysis, and a recovery procedure
are verified.

Before any firmware experiment, use the separately guarded ESP32-S3 workflow in
[recovery/README.md](./recovery/README.md). It inventories security/eFuses and
captures full flash, partition table, NVS, and filesystem images without
implementing any device erase or write operation.
