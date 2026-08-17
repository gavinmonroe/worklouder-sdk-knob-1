# Render-v2 MicroQuickJS canary package example

This hardware-free example builds one deterministic `F2JS` package with the
public renderer-v2 SDK. Its widget demonstrates a one-second timer, Fn+bottom
knob rotation, a key-held modifier for coarse knob steps, key down/hold, an
exact two-key chord, and one declared host RPC.

The two native key tokens are deliberately synthetic. The output is **not
deployable to a keyboard**, is not a capability receipt, and performs no HID,
serial, RPC, or flash I/O.

From the repository root:

```sh
node f1-widget-sdk/examples/render-v2-mquickjs-canary/build.mjs
```

The command writes `build/timer-multi-input.f2js` and a small offline manifest.
Running it twice from unchanged source produces the same package bytes and
SHA-256. The frozen generation-1 artifact is 1,576 bytes with package SHA-256
`68a53cd4300cdfe5f8c22071f0488046f6e21a11ee9054e162bfd74b0ae8fdb9`
and source SHA-256
`fc6b426f49579872eb6f961f141863aecd078f187809459e0c56743d02039fe9`.
The umbrella verifier copies and re-decodes this exact artifact in
[`../../../experiments/mquickjs-canary-bundle`](../../../experiments/mquickjs-canary-bundle).
See
[`../../docs/render-v2-mquickjs.md`](../../docs/render-v2-mquickjs.md) for the
event fields, limits, capability gate, and physical-canary checklist.

Input Lab's reusable host library can model the example's key, hold, chord,
overflow, and held-key-plus-knob semantics. The visible app does not yet expose
this as a MicroQuickJS editor or device-push backend, and the synthetic tokens
cannot be used as physical key identities.

The example uses the current slot facade:

| Slot | Meaning |
| ---: | --- |
| 0 | Timer seconds |
| 1 | Running flag (`0` or `1`) |
| 2 | Accumulated dial detents |
| 3 | Last update reason (`1` tick, `2` knob, `3` key, `4` hold, `5` chord, `6` RPC) |

Holding admitted key `0` while an `input.fn-bottom-knob` event arrives changes
the step from five seconds to sixty seconds. This works because every callback
event carries the same held-key snapshot and `widget.isHeld(event, 0)` reads
that snapshot. It does not infer a physical key name.
