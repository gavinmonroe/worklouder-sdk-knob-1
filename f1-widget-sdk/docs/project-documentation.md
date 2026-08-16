# Per-widget documentation system

Every generated project includes:

- `docs/README.md` for immutable descriptor order, roster, states, and input.
- `docs/DECISIONS.md` for decisions, evidence, and revisit conditions.
- `docs/TESTING.md` for offline checks and a separate hardware handoff record.

Every build emits a machine-generated manifest containing input/output hashes,
descriptor/data addresses, DROM growth pages, boundary evidence, roster/input
metadata, converter/toolchain identity, code entry, mutation allowlist,
checksum/digest, partition headroom, preserved stock callbacks, and rollback
reference. Do not hand-edit manifests.

Use these evidence labels:

- **FACT**: reproduced from exact bytes or deterministic tools.
- **OBSERVED**: seen during a named live test with its exact candidate recorded.
- **INFERENCE**: explanation consistent with facts and observations.
- **PENDING**: proposed behavior or unverified ABI.
- **REJECTED**: disproven approach retained to prevent repetition.

The Stage-3E.2 result is the model: white pets and lower-screen twinkle
corruption are OBSERVED; the `0x3c1d0000` alignment is FACT; a DROM mapping
fault is only an INFERENCE. Do not promote it to a contract until a controlled
candidate isolates the variable and reproduces the repair.

For a live experiment outside this SDK, record exact app/merged hashes, recovery
reference, write/read-back hashes, checksum/digest, boot health, visual result,
stock-screen health, and rollback result. This SDK itself never deploys.
