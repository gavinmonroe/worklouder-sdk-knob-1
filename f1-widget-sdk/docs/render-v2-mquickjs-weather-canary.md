# MicroQuickJS weather canary proof note

The isolated weather canary is implemented at
[`../examples/render-v2-mquickjs-weather-canary`](../examples/render-v2-mquickjs-weather-canary).
It reuses the existing normalized ZIP/weather bitfields and adds a strict
`F2JS` program, deterministic host provider, revision-stage-commit delivery
model, applied-revision flow control, timer freshness, last-good recovery,
hidden-screen policy, 16-slot/16-target screen contract, and golden simulator.

Its generated status is `STATIC_OFFLINE_NOT_FLASHABLE`. The frozen package is
generation 18, SHA-256
`88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20`;
its exact 5,667-byte source SHA-256 is
`68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b`.
The proof covers package admission, host-simulated state behavior, and real
pinned-engine execution on the development host. The normal run uses 61,496
of the fixed 65,536-byte heap, leaving exactly 4,040 bytes; moving-GC/ASan also
passes. This does not cover physical MicroQuickJS execution or on-device
dynamic pixels.

The specialized weather `F2TF` companion is now proven offline at 1,375 bytes,
SHA-256 `d9e2ce701755423dc9d843eace93f51f982d1f5cb7c231c6fb9a5f1f1dc9bc94`,
with contract SHA-256
`8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a`.
Its host oracle and freestanding C consumer produce pixel-exact frames for all
11 weather/error/torn-state cases. That closes the static mapping shape, not
the stock-UI link, physical timing, or device receipt.

ZIP/country/unit input, geocoding, provider requests, caching/backoff, and
attribution are a host-companion responsibility. The keyboard receives only
normalized packed RPC fields and never receives provider credentials or a
network API. The included deterministic provider exercises the same boundary
without network access.

Physical integration must connect and prove three interfaces before this
screen can be enabled:

1. the statically proven resident VM/parser/task and atomic slot mailbox;
2. the statically proven bounded `F2TF` slot-to-pixel consumer on the stock UI
   task;
3. serialized host-RPC backpressure, exact event/control receipts, an exact
   applied-revision receipt, and persistent revision bootstrap.

Input Lab can use the package and deterministic host simulation as an offline
fixture today. It must keep device push disabled: the visible application does
not yet expose a MicroQuickJS project editor/weather configuration flow, and no
physical keyboard advertises the target facade or exact weather receipt
extensions.

The full protocol, commands, slot table, tests, hidden policy, capability
extension names, and the umbrella readiness-bundle link live in the example
README so the example and its proof remain self-contained.
