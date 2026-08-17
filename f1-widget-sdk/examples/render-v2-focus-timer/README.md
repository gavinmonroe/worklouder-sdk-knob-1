# Render v2 focus timer (ID27)

This is a separate timer widget. It does not replace the focus clock/ID26.
The offline RGB565 face keeps the same black, warm-orange radial dial language,
but the four large safe-area digits are `MM:SS`. ID27 borrows the exact frozen
focus-clock/ID26 RGB565 base; its bounded F2EP patches clear/repaint the timer
header, digits, and detent. There is no second timer F1WB or framebuffer.

Fn plus the bottom knob edits `remainingSeconds` immediately in signed five-
minute steps using the bounded authored instruction
`remainingSeconds += event.delta * 300;`. Editing clamps to `05:00..95:00`.
Opcode 8 evaluates the multiply and add modulo 2^32, without C signed-overflow
behavior. `tick.1s` then decrements automatically to zero. The highlighted
needle clicks through five visual detents independently of the countdown.

Only the visible screen controller receives UI ticks. The timer therefore
pauses while another widget is visible and resumes from its retained value on
return. It is intentionally not a hidden wall-clock alarm. Fixed RPC `0xB201`
is an ID26 clock diagnostic in the combined firmware; setting ID27 uses Fn plus
the bottom knob and does not require a computer connection.

The top status begins at y=16. All top-row and large-digit pixels stay at least
five pixels from the physical left/right edges; the large digits occupy
x=5..91. The radial dial intentionally reaches the display perimeter.

From `f1-widget-sdk`:

```sh
node examples/render-v2-focus-timer/build.mjs
node --test test/render-v2-focus-timer.test.mjs test/render-v2-focus-timer-package.test.mjs
```

`build/lifecycle-contact-sheet.png` shows initial, turn+, turn-, one automatic
countdown tick, and the compiler's fixed-event boundary case.
`build/boundary-contact-sheet.png` locks `05:00`, the `00:00` countdown floor,
`55:00`, `60:00`, and `95:00`, including the raster-only minute-tens selector
override. The build emits the timer F2EP and an accounting concatenation
proving that one focus F1WB plus both F2EP programs fit the single 98,304-byte
store. ID26 and ID27 also share the one 62,000-byte framebuffer.

The example build itself is offline and never writes a device. After flashing
the exact matching combined firmware, its explicit RAM-only publisher is:

```sh
node examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs --confirm-live-rpc
```

The publisher transfers the generation-paired clock+timer package and performs
no host-time synchronization; ID26 reads the shared stock device RTC. It is
valid only with the matching combined image and does not replace the guarded
app-only flash workflow.
